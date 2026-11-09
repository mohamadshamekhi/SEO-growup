// Ported from hub/cli.py's `create-admin` subcommand: --username/--name on the CLI, password
// asked for interactively (never on argv/history/CI logs). Run inside the container:
//   docker compose exec hub-next npx tsx scripts/create-admin.ts --username NAME --name "Full Name"
import { createUser } from "../lib/auth";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.resume();
    stdin.setEncoding("utf8");
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = "";
    const onData = (ch: string) => {
      if (ch === "\n" || ch === "\r" || ch === "\u0004") {
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(!!wasRaw);
        stdin.pause();
        process.stdout.write("\n");
        resolve(input);
      } else if (ch === "\u0003") {
        process.exit(1);
      } else if (ch === "\u007f" || ch === "\b") {
        input = input.slice(0, -1);
      } else {
        input += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const username = flag("username");
  const name = flag("name");
  if (!username || !name) {
    console.error('Usage: create-admin.ts --username NAME --name "Full Name"');
    process.exit(1);
  }
  const password = await askHidden("رمز ادمین جدید: ");
  if (password.length < 8) {
    console.error("رمز باید حداقل ۸ کاراکتر باشد");
    process.exit(1);
  }
  const confirm = await askHidden("تکرار رمز: ");
  if (password !== confirm) {
    console.error("رمزها یکسان نیستند");
    process.exit(1);
  }
  const id = createUser(name, username, password, true);
  console.log(`کاربر ادمین #${id} ساخته شد: ${username}`);
}

main();
