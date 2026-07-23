import { cp } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const rendererSourceDirectory = join(root, "src", "renderer");
const rendererTargetDirectory = join(root, "dist", "renderer");
const iconsSourceDirectory = join(root, "src", "icons");
const iconsTargetDirectory = join(root, "dist", "icons");

await cp(rendererSourceDirectory, rendererTargetDirectory, { recursive: true });
await cp(iconsSourceDirectory, iconsTargetDirectory, { recursive: true });
