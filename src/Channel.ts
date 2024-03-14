import { EventEmitter } from "stream";
import { Proxy } from "./type";
import { ShadowSocket } from "./ShadowSocket";

export class Channel extends EventEmitter {
    socket: number = 0
    config!: Proxy

    socks = new Map<number, ShadowSocket>()

    constructor(proxy: Proxy) {
        super()

        this.config = proxy
    }

}