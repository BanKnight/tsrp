import { readFileSync } from "fs"
import { resolve } from "path"
import { parse } from "yaml"
import { Config } from "~/type"

const file = "./client.example.yaml"

const content = readFileSync(resolve(file), "utf-8")
const config = parse(content) as Config

export { config }