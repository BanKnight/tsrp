import { Socket, createConnection } from "net";
import { Config } from "./type";
import { finished } from "stream";
import { Session } from "./Session";
import { Channel } from "./Channel";
import { ShadowSocket } from "./ShadowSocket";
import { createSocket } from "dgram";

export class ClientApp {

    channels = [] as Array<Channel>

    constructor(private config: Config) { }

    start() {
        this.connect()
    }

    private connect() {
        const socket = createConnection(parseInt(this.config.port), this.config.host, () => {
            console.log(`${this.config.host}:${this.config.port} connected`)

            const session = new Session(socket)

            session.setMaxListeners(10000)

            this.prepare(session)
        })

        socket.setKeepAlive(true)
        socket.setNoDelay(true)

        const destroy = () => {
            socket.destroySoon()
            console.error("connection lost,retry in 3 seconds")
            setTimeout(this.connect.bind(this), 3000)
        }

        socket.on("error", console.error)

        finished(socket, destroy)
    }

    async prepare(session: Session) {

        session.send({
            func: "login",
            body: { name: this.config.name, token: this.config.token }
        })

        for (let i = 0; i < this.config.proxies.length; ++i) {

            const proxy = this.config.proxies[i]!
            const id = i + 1

            session.send({
                func: "listen",
                body: {
                    socket: id,
                    port: proxy?.serverPort,
                    protocol: proxy?.type
                }
            })

            const inst = new Channel(proxy)

            this.channels.push(inst)
        }

        session.on("accept", (body: { socket: number, remote: number, port: number, host: string }) => {

            const channel = this.channels[body.socket - 1]!

            const client = new ShadowSocket(session)

            client.socket = body.remote
            client.port = body.port
            client.host = body.host

            channel.socks[client.socket] = client

            const funcName = `proxy_${channel.config.type}`
            //@ts-ignore
            const func = this[funcName]! as Function

            func.call(this, session, channel, client)
        })

        session.on("data", (body: { socket: number, data: Buffer }) => {
            const id = Math.floor(body.socket / 10000000)
            const channel = this.channels[id - 1]

            if (channel == null) {
                session.send({
                    func: "close",
                    body: {
                        socket: body.socket
                    }
                })
                return
            }

            const shadow = channel.socks[body.socket]
            if (shadow == null) {
                session.send({
                    func: "close",
                    body: {
                        socket: body.socket
                    }
                })
                return
            }

            // 因为有可能连接还没建立，但是数据过来了，此时需要保存一段时间
            // 所以需要先拷贝走
            shadow.emit("data", Buffer.from(body.data))
        })

        session.on("close", (body: { socket: number }) => {
            const id = Math.floor(body.socket / 10000000)
            const channel = this.channels[id - 1]
            if (channel == null) {
                return
            }
            const shadow = channel.socks[body.socket]
            if (shadow == null) {
                return
            }
            shadow.emit("close")
            delete channel.socks[body.socket]
        })
    }

    private proxy_tcp(session: Session, channel: Channel, shadow: ShadowSocket) {

        let connected = false
        let target: Socket

        function flushTarget() {
            const buffer = shadow.pendings.shift()
            if (buffer == null) {
                return
            }

            target.write(buffer)

            if (shadow.pendings.length > 0) {
                flushTarget()
            }
        }

        target = createConnection({ host: channel.config.clientHost, port: channel.config.clientPort }, () => {
            console.log("tcp connected", shadow.socket, channel.config.clientHost, channel.config.clientPort)
            connected = true
            flushTarget()
        })

        target.setKeepAlive(true)
        target.setNoDelay(true)
        target.setTimeout(3000)

        target.on("error", (error) => {
            console.error(shadow.socket, channel.config.clientHost, channel.config.clientPort, error)
            target.destroySoon()
        })

        target.on("data", (data) => {
            let read = 0
            while (read < data.length) {
                const len = Math.min(data.length - read, 65530)
                session.send({
                    func: "data",
                    body: {
                        socket: shadow.socket,
                        data: data.subarray(read, read += len)
                    }
                })
            }
        })

        shadow.on("data", (data: Buffer) => {
            if (shadow.pendings.length > 0 || !connected) {
                shadow.pendings.push(data)
            }
            else {
                target.write(data)
            }
        })
        shadow.once("close", () => {
            if (target.destroyed) {
                return
            }
            target.destroySoon()
        })

        const destroy = () => {
            session.send({
                func: "close",
                body: {
                    socket: shadow.socket
                }
            })

            connected = false

            if (!target.destroyed) {
                target.destroy()
            }
        }

        finished(target, destroy)
        session.once("destroy", destroy)
    }

    private proxy_udp(session: Session, channel: Channel, shadow: ShadowSocket) {

        let connected = false
        const target = createSocket("udp4")

        function flushTarget() {
            const buffer = shadow.pendings.shift()
            if (buffer == null) {
                return
            }

            target.send(buffer)

            if (shadow.pendings.length > 0) {
                flushTarget()
            }
        }

        target.connect(channel.config.clientPort, channel.config.clientHost, () => {
            connected = true
            console.log("udp connected", channel.config.clientPort, channel.config.clientHost)
            flushTarget()
        })

        target.on("message", (data) => {
            session.send({
                func: "data",
                body: {
                    socket: shadow.socket,
                    data: data
                }
            })
        })

        target.on("error", () => {
            target.close()
        })

        target.once("close", () => {
            connected = false

            session.send({
                func: "close",
                body: {
                    socket: shadow.socket
                }
            })
        })

        shadow.on("data", (data: Buffer) => {
            if (shadow.pendings.length > 0 || !connected) {
                shadow.pendings.push(data)
            }
            else {
                target.send(data)
            }
        })

        shadow.once("close", () => {
            target.close()
        })

        session.once("destroy", () => {
            target.close()
        })
    }
}