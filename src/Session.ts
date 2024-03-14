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
        read: 0,
        buffer: Buffer.alloc(65536 + 12),
        write: 0,
    }

    socks = {} as Record<number, ShadowSocket>

    constructor(public socket: Socket) {
        super()

        const recv = {
            buffer: Buffer.alloc(65536 * 2),
            read: 0,
            write: 0
        }

        this.socket.on("data", (chunk: Buffer) => {

            const tailLeft = recv.buffer.length - recv.write
            const totalLeft = recv.buffer.length - (recv.write - recv.read)

            // 末尾剩余的位置够，那么直接塞到后面去
            if (chunk.length <= tailLeft) {
                recv.write += chunk.copy(recv.buffer, recv.write)
            }
            else if (chunk.length <= totalLeft) {
                //移动位置
                recv.buffer.copy(recv.buffer, 0, recv.read, recv.write)
                recv.write = recv.write - recv.read
                recv.read = 0

                recv.write += chunk.copy(recv.buffer, recv.write)
            }
            else {
                console.error(`${socket.remoteAddress}:${socket.remotePort},接收到超大的buffer，对端很危险，干掉对方`, chunk.length, recv.write, recv.read)
                this.socket.destroy()
                return
            }

            while (true) {
                const readable = recv.write - recv.read
                if (readable < 4) {
                    break
                }

                const len = recv.buffer.readUint16BE(recv.read)
                if (len == 0) {     // 超支了，干掉
                    console.error(`${socket.remoteAddress}:${socket.remotePort} 协议中的长度不正确，对端很危险，干掉对方：${len}`)
                    this.socket.destroy()
                    return
                }

                if (readable - 2 < len) {       //等待数据
                    break
                }

                recv.read += 2

                const temp = {
                    buffer: recv.buffer.subarray(recv.read, recv.read += len),
                    read: 0,
                    write: len
                }

                try {
                    const packet = Packet.read(temp)
                    if (temp.read != temp.write) {
                        console.log("recv packet:" + JSON.stringify({ cmd: packet.cmd, body: { func: packet.body.func } }))
                        console.error("💀💀", "协议错误", len, temp.read, temp.write)
                    }

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
                }
                catch (e: any) {
                    console.error(e)
                    this.socket.destroy()
                    break
                }
            }
        })

        finished(this.socket, () => {
            this.emit("destroy")
        })
    }

    destroy() {
        if (this.socket.destroyed) {
            return
        }
        this.socket.destroy()

        this.emit("destroy")
    }

    send(info: { func: string, body: any }) {
        const packet = {
            cmd: 0x01,
            body: info
        }
        this.sendPacket(packet)

        // if (info.func != "data") {
        //     console.log("send packet:", JSON.stringify(packet))
        // }
    }

    private sendPacket(packet: { cmd: number, body: any }) {

        const context = this.sendCtx

        context.read = 0
        context.write = 2

        Packet.write(context, null, packet)

        const len = context.write - 2

        context.buffer.writeUint16BE(len)

        if (this.socket.writable) {
            this.socket.write(context.buffer.subarray(0, context.write))
        }
    }

    call(info: { func: string, body: any }) {

        const rpc = ++this.session

        const packet = {
            cmd: 0x02,
            body: {
                session: rpc,
                ...info
            }
        }

        this.sendPacket(packet)

        return new Promise((resolve, reject) => {
            this.rpcs[rpc] = { resolve, reject }
        })
    }

    private async onSend(packet: { func: string, body: any }) {

        if (packet.func != "data") {
            console.log("recv packet", JSON.stringify(packet))
        }

        this.emit(packet.func, packet.body)
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

        const packet = {
            cmd: 0x03,
            body: info
        }

        this.sendPacket(packet)
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
        const packet = {
            cmd: 0x04,
            body: info
        }

        this.sendPacket(packet)
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