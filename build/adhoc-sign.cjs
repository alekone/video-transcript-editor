// Firma ad-hoc dell'app dopo il packaging. Su Apple Silicon un binario non
// firmato + quarantena risulta "danneggiato": la firma ad-hoc lo evita
// (l'app si apre con "tasto destro → Apri", o dopo `xattr -dr com.apple.quarantine`).
// Per una firma "pubblica" senza avvisi serve invece un Apple Developer ID + notarizzazione.
const { execSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: "inherit" });
  console.log(`[adhoc-sign] firmato ad-hoc: ${app}`);
};
