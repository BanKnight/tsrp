import { Duplex, finished } from "stream";
import { Server, Socket, createServer, createConnection } from "net";
import { Context } from "typebuffer";
import { Packet } from "./proto";
import EventEmitter from "events";
import { ShadowSocket, ShadowServer } from "./ShadowSocket";

type Resolve = (value: any) => void
type Reject = (reason?: any) => void

type Rpc = { resolve: Resolve, reject: Reject }

export class Session extends EventEmitter {

    name = ""
    session = 0
    rpcs = {} as Record<number, Rpc>

    sendCtx: Context = {
        buffer: Buffer.alloc(65536),
        offset: 0,
    }

    socks = {} as Record<number, ShadowSocket>

    constructor(private socket: Duplex) {
        super()

        const buffer = Buffer.alloc(65536 + 2)

        const recv = {
            buffer: buffer.subarray(0),
            offset: 0
        }

        this.socket.on("data", (chunk: Buffer) => {

            const left = recv.buffer.length - recv.offset

            if (chunk.length > left) {
                if (left + buffer.length - recv.buffer.length < chunk.length) {
                    this.socket.destroy()
                    return
                }
                //移动位置
                recv.buffer.copy(buffer, 0, 0, recv.offset)
                recv.buffer = buffer.subarray(0)
            }

            chunk.copy(recv.buffer, recv.offset)

            recv.offset += chunk.length

            if (recv.offset < 4) {
                return
            }

            const len = recv.buffer.readUint16BE()
            if (recv.offset - 2 < len) {
                return
            }

            const recvCtx = {
                buffer: recv.buffer.subarray(2, 2 + len),
                offset: 0
            }

            const packet = Packet.read(recvCtx)

            switch (packet.cmd) {
                case 0x01:
                    this.onSend(packet.body)
                    break
                case 0x02:
                    this.onCall(packet.body)
                    break
                case 0x03:
                    this.onError(packet.body)
                    break
                case 0x04:
                    this.onResp(packet.body)
                    break
            }
        })

        finished(this.socket, () => {
            this.emit("close")
        })
    }

    close() {
        if (this.socket.destroyed) {
            return
        }
        this.socket.destroy()
    }


    async listen(info: { socket: number, port: number, protocol: "tcp" | "udp" }) {

        this.send({
            func: "listen",
            body: info
        })

    }

    send(info: { func: string, body: any }) {

        const context = this.sendCtx

        const packet = {
            cmd: 0x01,
            send: info
        }

        context.offset = 2

        Packet.write(context, null, packet)

        const len = context.offset - 2

        context.buffer.writeUint16BE(len)

        this.socket.write(this.sendCtx.buffer.subarray(0, this.sendCtx.offset))
    }

    call(info: { func: string, body: any }) {
        const rpc = ++this.session

        const context = this.sendCtx
        const packet = {
            cmd: 0x02,
            call: info
        }

        context.offset = 2

        Packet.write(context, null, packet)

        const len = context.offset - 2

        context.buffer.writeUint16BE(len)

        this.socket.write(this.sendCtx.buffer.subarray(0, this.sendCtx.offset))

        return new Promise((resolve, reject) => {
            this.rpcs[rpc] = { resolve, reject }
        })
    }

    private async onSend(packet: { func: string, body: any }) {

        const events = this.listeners(packet.func)

        if (events.length == 0) {
            return
        }

        let result
        for (const func of events) {
            result = await func(packet.body)
        }

        return result
    }

    private async onCall(packet: { session: number, func: string, body: any }) {

        try {
            const result = await this.onSend(packet)

            this.response({
                session: packet.session,
                body: result
            })
        }
        catch (e: any) {

            this.error({
                session: packet.session,
                body: e
            })
        }

    }

    private error(info: { session: number, body: any }) {

        const context = this.sendCtx

        const packet = {
            cmd: 0x03,
            body: info
        }

        context.offset = 2

        Packet.write(context, null, packet)

        const len = context.offset - 2

        context.buffer.writeUint16BE(len)

        this.socket.write(this.sendCtx.buffer.subarray(0, this.sendCtx.offset))
    }

    private onError(packet: { session: number, error: any }) {
        const rpc = this.rpcs[packet.session]
        if (rpc == null) {
            return
        }

        delete this.rpcs[packet.session]

        rpc.reject(packet.error)
    }

    private response(info: { session: number, body: any }) {

        const context = this.sendCtx

        const packet = {
            cmd: 0x04,
            body: info
        }

        context.offset = 2

        Packet.write(context, null, packet)

        const len = context.offset - 2

        context.buffer.writeUint16BE(len)

        this.socket.write(this.sendCtx.buffer.subarray(0, this.sendCtx.offset))
    }

    private onResp(packet: { session: number, body: any }) {
        const rpc = this.rpcs[packet.session]
        if (rpc == null) {
            return
        }

        delete this.rpcs[packet.session]

        rpc.resolve(packet.body)
    }

}