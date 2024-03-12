import { program } from '@commander-js/extra-typings';
import { ServerApp } from './ServerApp';
import { parse } from "yaml";
import { Config } from "./type";
import { readFileSync } from "fs";
import { join, resolve, basename, dirname } from "path";
import { ClientApp } from './ClientApp';

program
    .option('-c, --config <file>', 'specifi your config', 'config.yaml');

program.parse();

const options = program.opts() as any

const file = options.config as string
const content = readFileSync(resolve(file), "utf-8")
const config = parse(content) as Config

const app = config.mode == "server" ? new ServerApp(config) : new ClientApp(config)

app.start()




