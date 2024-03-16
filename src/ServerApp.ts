import { createSocket } from "dgram";
import { Session } from "./Session";
import { Config } from "./type";
import { Server, Socket, createServer, createConnection } from "net";
import { finished } from "stream";
import { ShadowSocket } from "./ShadowSocket";

export class ServerApp {
    server!: Server;
    sessions = {} as Record<string, Session>

    constructor(private config: Config) { }

    start() {
        this.server = createServer()

        this.server.on("listening", () => {
            console.log(`${this.config.name} is listening ${this.config.port}`)
        })

        this.server.on("connection", (socket: Socket) => {

            const session = new Session(socket)

            session.setMaxListeners(10000)

            session.once("login", (info: { name: string, token: string }) => {
                if (info.token != this.config.token) {
                    console.log(`session[${info.name}] logined failed because of token error`)
                    socket.destroySoon()
                    return
                }

                session.name = info.name

                const existed = this.sessions[session.name]
                if (existed) {
                    existed.socket.destroy()
                    console.log(`conflict session[${info.name}] from ${session.socket.remoteAddress}:${session.socket.remotePort}`)
                }

                this.sessions[session.name] = session

                console.log(`session[${info.name}] logined from ${socket.remoteAddress}:${socket.remotePort}`)

                finished(socket, () => {
                    delete this.sessions[session.name]
                    console.log(`session[${session.name}] from ${session.socket.remoteAddress}:${session.socket.remotePort} lost connection`)
                    session.emit("destroy")
                })

                this.prepare(session)
            })
        })

        this.server.on("error", (e: any) => {
            if (e.code == 'EADDRINUSE') {
                console.error(e)
                //Retry
                return
            }
        })

        this.server.listen({
            host: this.config.host ?? "0.0.0.0",
            port: this.config.port,
            backlog: 512
        })
    }

    prepare(session: Session) {

        const shadows = {} as Record<number, ShadowSocket>

        session.on("listen", (info: { socket: number, port: number, protocol: "tcp" | "udp" }) => {
            switch (info.protocol) {
                case "tcp":
                    this.listenTcp(session, shadows, info)
                    break
                case "udp":
                    this.listenUdp(session, shadows, info)
                    break
            }
        })

        session.on("data", (body: { socket: number, data: Buffer }) => {
            const shadow = shadows[body.socket]
            if (shadow == null) {
                session.send({
                    func: "close",
                    body: {
                        socket: body.socket
                    }
                })
                return
            }
            //由于很快就发走，不用考虑拷贝
            shadow.emit("data", body.data)
        })

        session.on("close", (body: { socket: number }) => {
            const shadow = shadows[body.socket]
            if (shadow == null) {
                return
            }

            shadow.emit("close")
            delete shadows[body.socket]
        })
    }

    listenTcp(session: Session, shadows: Record<number, ShadowSocket>, info: { socket: number, port: number }) {

        const server = createServer()

        server.setMaxListeners(10000)

        let idHelper = 0
        let count = 0

        server.on("listening", () => {
            console.log(`socket[${info.socket}] from session[${session.name}] listen tcp ${info.port} ok`)
        })

        server.on("connection", (socket: Socket & { id: number }) => {

            count++
            console.log(count, "new tcp connection", socket.remoteAddress, socket.remotePort)

            socket.setKeepAlive(true)
            socket.setNoDelay(true)
            socket.setTimeout(3000)

            socket.id = info.socket * 10000000 + (++idHelper % 10000000)

            const shadow = shadows[socket.id] = new ShadowSocket(session)
            shadow.socket = socket.id

            session.send({
                func: "accept",
                body: {
                    socket: info.socket,
                    remote: socket.id,
                    port: socket.remotePort,
                    host: socket.remoteAddress
                }
            })

            socket.on("data", (data) => {
                // console.log(data.toString("utf-8"))
                let read = 0
                while (read < data.length) {
                    const len = Math.min(data.length - read, 63000)
                    session.send({
                        func: "data",
                        body: {
                            socket: socket.id,
                            data: data.subarray(read, read += len)
                        }
                    })
                }
            })

            shadow.on("data", (data: Buffer) => {
                // console.log(data.toString("utf-8"))
                if (socket.writable) {
                    socket.write(data)
                }
            })

            socket.once("error", () => {
                socket.destroySoon()
            })

            socket.once("close", () => {
                count--
                console.log(count, "close tcp connection", socket.remoteAddress, socket.remotePort)
            })

            const destroy = () => {

                shadow.off("close", destroy)
                server.off("close", destroy)
                socket.off("close", destroy)

                shadow.emit("close")

                delete shadows[socket.id]

                session.send({
                    func: "close",
                    body: {
                        socket: socket.id,
                    }
                })

                if (!socket.destroyed) {
                    socket.destroySoon()
                    return
                }
            }

            finished(socket, destroy)

            shadow.once("close", destroy)
            server.once("close", destroy)
        })

        server.on("error", (e: any) => {

            console.error(`socket[${info.socket}] from session[${session.name}] listen tcp ${info.port} error:${e}`)

            setTimeout(server.close.bind(server), 100)

            if (e.code === 'EADDRINUSE') {
                return
            }
        })

        server.listen({
            port: info.port,
            host: "0.0.0.0",
            backlog: 512
        })

        session.once("destroy", server.close.bind(server))
    }

    listenUdp(session: Session, shadows: Record<number, ShadowSocket>, info: { socket: number, port: number }) {

        let idHelper = 0
        let count = 0

        const remotes = {} as Record<string, ShadowSocket>
        const server = createSocket("udp4")

        server.setMaxListeners(10000)

        server.on("listening", () => {
            console.log(`socket[${info.socket}] from session[${session.name}] listen udp ${info.port} ok`)
        })

        server.on('message', (message, remote_info) => {

            const address = `${remote_info.address}:${remote_info.port}`

            let shadow = remotes[address]

            if (shadow) {
                session.send({
                    func: "data",
                    body: {
                        socket: shadow.socket,
                        data: message
                    }
                })
                return
            }

            count++
            console.log(count, "new udp connection,count:", remote_info.address, remote_info.port)

            const id = info.socket * 10000000 + (++idHelper % 10000000)

            shadow = shadows[id] = remotes[address] = new ShadowSocket(session)

            shadow.socket = id

            session.send({
                func: "accept",
                body: {
                    socket: info.socket,
                    remote: id,
                    port: remote_info.port,
                    host: remote_info.address
                }
            })

            session.send({
                func: "data",
                body: {
                    socket: shadow.socket,
                    data: message
                }
            })

            shadow.on("data", (data: Buffer) => {
                server.send(data, remote_info.port, remote_info.address)
            })

            shadow.once("close", () => {
                delete shadows[shadow!.socket]
                delete remotes[address]

                count--
                console.log("udp connection closed ,count:", count)
            })
        })

        server.on("error", (e: any) => {

            console.error(`socket[${info.socket}] from session[${session.name}] listen[${info.port}] error:${e}`)

            setTimeout(server.close.bind(server), 100)

            session.off("destroy", closeServer)

            if (e.code === 'EADDRINUSE') {
                return
            }
        })

        server.bind(info.port)

        const closeServer = () => {
            server.close()
            session.off("destroy", closeServer)
        }

        session.once("destroy", closeServer)
    }
}