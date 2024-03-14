import EventEmitter from "events";

export interface Proxy {
    name: string;
    type: "tcp" | "udp";
    serverPort: number;
    clientPort: number;
    clientHost?: string;
    timeout?: number;
}

export interface Config {
    name: string;
    token: string;
    port: string;
    host: string;
    proto: "tcp";
    mode: "server" | "client";
    proxies: Proxy[];
}
