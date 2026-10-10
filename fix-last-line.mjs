import fs from "fs";
const p = "C:/Users/PRESTIGE/Downloads/ChoyxonaAzizxon/src/routes/cashier.routes.ts";
let s = fs.readFileSync(p, "utf8");
s = s.replace("\\Qaytarishlar: \\`r", "`Qaytarishlar: ${totalRefunds.toString()}`");
fs.writeFileSync(p, s);
console.log("done");
