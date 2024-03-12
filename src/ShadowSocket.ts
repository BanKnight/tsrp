import { EventEmitter } from "stream";
import { Session } from "./Session";

export class ShadowSocket extends EventEmitter {
    socket: number = 0
    host: string = ""
    port: number = 0

    constructor(private session: Session) {
        super()
    }
}

export class ShadowServer extends ShadowSocket {
    constructor(session: Session) {
        super(session)
    }
}