import { program } from '@commander-js/extra-typings';
import { ServerApp } from './ServerApp';
import { parse } from "yaml";
import { Config } from "./type";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ClientApp } from './ClientApp';

program
    .option('-c, --config <file>', 'specifi your config', 'config.yaml');

program.parse();

const options = program.opts() as any

const file = resolve(options.config as string)

try {
    const content = readFileSync(file, "utf-8")
    const config = parse(content) as Config

    const app = config.mode == "server" ? new ServerApp(config) : new ClientApp(config)

    app.start()
}
catch (e: any) {
    console.error("start error")
    console.error(e)
    process.exit(1)
}




