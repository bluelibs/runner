import { promises as fs } from "node:fs";
import * as path from "node:path";

async function copyDocs() {
  console.log("sync-docs: starting");
  const filesToCopy = [
    {
      src: path.join("node_modules", "@bluelibs", "runner", "AI.md"),
      dest: path.join("readmes", "runner-AI.md"),
    },
    {
      src: path.join("node_modules", "@bluelibs", "runner", "README.md"),
      dest: path.join("readmes", "runner-README.md"),
    },
    {
      src: path.join("node_modules", "@bluelibs", "runner-dev", "AI.md"),
      dest: path.join("readmes", "runner-dev-AI.md"),
    },
  ];

  await fs.mkdir("readmes", { recursive: true });

  for (const file of filesToCopy) {
    console.log("sync-docs: attempting copy", file.src, "->", file.dest);
    try {
      await fs.copyFile(file.src, file.dest);
      console.log(`Copied ${file.src} to ${file.dest}`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error(`Failed to copy ${file.src}:`, err.message);
      } else {
        console.error(`Failed to copy ${file.src}:`, String(err));
      }
    }
  }
}

copyDocs();
