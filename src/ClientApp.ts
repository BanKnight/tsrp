import { createConnection } from "net";
import { Config } from "./type";
import { EventEmitter, finished } from "stream";
import { Session } from "./Session";
import { Channel } from "./Channel";
import { ShadowSocket } from "./ShadowSocket";

export class ClientApp {

    channels = [] as Array<Channel>

    constructor(private config: Config) { }

    start() {
        const socket = createConnection(parseInt(this.config.port), this.config.host, () => {
            console.log(`${this.config.host}:${this.config.port} connected`)

            const session = new Session(socket)

            this.prepare(session)
        })

        socket.setKeepAlive(true)
        socket.setNoDelay(true)

        const destroy = () => { }

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

            const inst = this.channels[body.socket - 1]!

            const client = new ShadowSocket(session)

            client.socket = body.remote
            client.port = body.port
            client.host = body.host

            inst.socks[client.socket] = client
        })

        session.on("data", (body: { socket: number, data: Buffer }) => {

            const id = Math.floor(body.socket / 10000000)
            const inst = this.channels[id]

            if (inst == null) {
                session.send({
                    func: "login",
                    body: {
                        socket: body.socket
                    }
                })
                return
            }

            const client = inst.socks[body.socket]
            if (client == null) {
                session.send({
                    func: "login",
                    body: {
                        socket: body.socket
                    }
                })
                return
            }
        })
    }
}