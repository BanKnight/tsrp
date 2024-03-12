import { createSocket } from "dgram";
import { Session } from "./Session";
import { Config } from "./type";
import { Server, Socket, createServer, createConnection } from "net";

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

            session.once("login", (info: { name: string, token: string }) => {
                if (info.token != this.config.token) {
                    session.close()
                    return
                }

                session.name = info.name

                this.sessions[session.name] = session
            })

            this.prepare(session)
        })

        this.server.on("error", (e: any) => {
            if (e.code == 'EADDRINUSE') {
                console.error(e)
                //Retry
                return
            }
        })

        this.server.listen(this.config.port)
    }

    prepare(session: Session) {

        session.on("listen", (info: { socket: number, port: number, protocol: "tcp" | "udp" }) => {

            switch (info.protocol) {
                case "tcp":
                    this.listenTcp(session, info)
                    break
                case "udp":
                    this.listenUdp(session, info)
                    break
            }

        })

    }

    listenTcp(session: Session, info: { socket: number, port: number }) {

        const server = createServer()

        let idHelper = 0

        server.on("listening", () => {
            console.log(`socket[${info.socket}] from session[${session.name}] listen tcp ${info.port} ok`)
        })

        server.on("connection", (socket: Socket & { id: number }) => {

            socket.setKeepAlive(true)
            socket.setNoDelay(true)

            socket.id = info.socket * 10000000 + (++idHelper % 10000000)

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
                session.send({
                    func: "transfer",
                    body: {
                        socket: socket.id,
                        data
                    }
                })
            })

            socket.on("close", () => {
                session.send({
                    func: "close",
                    body: {
                        socket: socket.id,
                    }
                })
            })
        })

        server.on("error", (e: any) => {

            console.error(`socket[${info.socket}] from session[${session.name}] listen tcp ${info.port} error:${e}`)

            setTimeout(server.close, 100)

            if (e.code === 'EADDRINUSE') {
                return
            }
        })

        server.listen(info.port)
    }

    listenUdp(session: Session, info: { socket: number, port: number }) {

        let idHelper = 0

        type Client = { remoteAddress: string, remotePort: number, id: number }

        const remotes = {} as Record<string, Client>
        const server = createSocket("udp4")

        server.on("listening", () => {
            console.log(`socket[${info.socket}] from session[${session.name}] listen udp ${info.port} ok`)
        })

        server.on('message', (message, remote_info) => {

            const address = `${remote_info.address}:${remote_info.port}`
            let client = remotes[address]

            if (client == null) {
                client = {
                    id: info.socket * 10000000 + (++idHelper % 10000000),
                    remoteAddress: remote_info.address,
                    remotePort: remote_info.port,
                }

                session.send({
                    func: "accept",
                    body: {
                        socket: info.socket,
                        remote: client.id,
                        port: client.remotePort,
                        host: client.remoteAddress
                    }
                })
            }

            session.send({
                func: "transfer",
                body: {
                    socket: client.id,
                    data: message
                }
            })
        })

        server.on("connection", (socket: Socket & { id: number }) => {

            socket.setKeepAlive(true)
            socket.setNoDelay(true)

            socket.id = info.socket * 100 + ++idHelper

            session.send({
                func: "accept",
                body: {
                    socket: info.socket,
                    remote: socket.id,
                    port: socket.remotePort,
                    host: socket.remoteAddress
                }
            })
        })

        server.on("error", (e: any) => {

            console.error(`socket[${info.socket}] from session[${session.name}] listen[${info.port}] error:${e}`)

            setTimeout(server.close, 100)

            if (e.code === 'EADDRINUSE') {
                return
            }
        })

        server.bind(info.port)
    }
}