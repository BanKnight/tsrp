import { finished } from "stream";
import { Socket } from "net";
import { Context } from "typebuffer";
import { Packet } from "./proto";
import EventEmitter from "events";
import { ShadowSocket } from "./ShadowSocket";

type Resolve = (value: any) => void
type Reject = (reason?: any) => void

type Rpc = { resolve: Resolve, reject: Reject }

export class Session extends EventEmitter {

    name = ""
    session = 0
    rpcs = {} as Record<number, Rpc>

    sendCtx: Context = {
        buffer: Buffer.allocUnsafe(65536 * 2),
        read: 0,
        write: 0,
    }

    socks = {} as Record<number, ShadowSocket>

    sent = 0        //发送的包的个数
    recv = 0        //接收的包的个数

    constructor(public socket: Socket) {
        super()

        const recv = {
            buffer: Buffer.allocUnsafe(65536 * 2),
            read: 0,
            write: 0
        }

        this.socket.on("data", (chunk: Buffer) => {

            const dataLeft = recv.write - recv.read
            const tailLeft = recv.buffer.length - recv.write
            const totalLeft = recv.buffer.length - dataLeft

            // 末尾剩余的位置够，那么直接塞到后面去
            if (chunk.length <= tailLeft) {
                recv.write += chunk.copy(recv.buffer, recv.write)
            }
            else if (chunk.length <= totalLeft) {

                if (dataLeft > 0) {
                    //移动位置
                    recv.buffer.copyWithin(0, recv.read, recv.write)
                    recv.write = dataLeft
                    recv.read = 0
                }
                else {
                    recv.read = recv.write = 0
                }

                recv.write += chunk.copy(recv.buffer, recv.write)
            }
            else {
                console.error(`${socket.remoteAddress}:${socket.remotePort},接收到超大的buffer，对端很危险，干掉对方`, chunk.length, recv.write, recv.read)
                this.socket.destroy()
                return
            }

            // const packets = []

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

                // packets.push({
                //     read: recv.read,
                //     len,
                //     buffer: recv.buffer.subarray(recv.read, recv.read + len + 2),
                // })

                recv.read += 2

                const temp = {
                    buffer: recv.buffer.subarray(recv.read, recv.read += len),
                    read: 0,
                    write: len
                }

                this.recv++

                try {
                    const packet = Packet.read(temp)

                    if (process.env.DEBUG) {
                        console.log(packet.index, "recv packet:", packet.cmd, packet.body.func, packet.body.body?.socket, len + 2)
                    }

                    if (temp.read != temp.write) {
                        console.log("recv packet:" + JSON.stringify({ cmd: packet.cmd, body: { func: packet.body.func } }))
                        throw new Error(`💀💀 协议错误,${len}, ${temp.read}, ${temp.write}`)
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
    }

    private checkBuffer() {
        const tailLength = this.sendCtx.buffer.length - this.sendCtx.write
        if (tailLength >= this.sendCtx.buffer.length * 0.5) {   //空间足够
            return this.sendCtx
        }

        this.sendCtx.buffer = Buffer.allocUnsafe(this.sendCtx.buffer.length)
        this.sendCtx.write = 0
        this.sendCtx.read = 0

        return this.sendCtx
    }

    private sendPacket(packet: { index?: number, cmd: number, body: any }) {

        if (!this.socket.writable) {
            return
        }

        this.sent++

        //@ts-ignore
        packet.index = this.sent

        const context = this.checkBuffer()
        const remain = context.buffer

        context.read = context.write
        context.write += 2      // len position

        Packet.write(context, null, packet)

        const len = context.write - context.read - 2

        remain.writeUint16BE(len, context.read)

        if (process.env.DEBUG) {
            if (packet.body.func != "data") {
                console.log(packet.index, "send packet", packet.cmd, packet.body.func, packet.body.body?.socket, context.write)
            }
            else {
                console.log(packet.index, "send packet", packet.cmd, packet.body.func, packet.body.body?.socket, context.write, packet.body.body.data.length)
            }
        }

        const value = this.socket.write(remain.subarray(context.read, context.write))

        if (!value) {
            return
        }

        context.write = context.read
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