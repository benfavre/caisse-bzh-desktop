// The actual Identity.Name and Publisher come from Partner Center > App identity.
// A preparation package exercises the build while company verification is pending.
const preparation = process.env.STORE_PREPARATION === "true";
const identityName = preparation
  ? "Webdesign29.CaisseBZH.Preparation"
  : process.env.STORE_IDENTITY_NAME?.trim();
const publisher = preparation
  ? "CN=Webdesign29-Preparation"
  : process.env.STORE_PUBLISHER?.trim();
if (!identityName || !publisher) {
  throw new Error("Final Store builds require STORE_IDENTITY_NAME and STORE_PUBLISHER from Partner Center. For a provisional package, set STORE_PREPARATION=true.");
}
if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) {
  throw new Error("Invalid Store package identity name.");
}
if (!publisher.startsWith("CN=") || /[<>"'&\r\n]/.test(publisher)) {
  throw new Error("Invalid Store publisher: copy the CN value from Partner Center.");
}
if (!preparation && (identityName.includes("Preparation") || publisher.includes("Preparation"))) {
  throw new Error("A provisional identity cannot be used for a final Store build.");
}

const base = require("./electron-builder.config.cjs");
module.exports = {
  ...base,
  directories: { ...base.directories, output: "release/store" },
  extraMetadata: { ...base.extraMetadata, windowsStoreBuild: true, macAutoUpdates: false },
  publish: null,
  forceCodeSigning: false,
  afterPack: require("./scripts/set-store-dpi.cjs"),
  artifactName: `caisse-bzh-\${version}-windows-store${preparation ? "-preparation" : ""}-\${arch}.\${ext}`,
  win: { ...base.win, target: [{ target: "appx", arch: ["x64"] }] },
  appx: {
    identityName,
    publisher,
    applicationId: "CaisseBZH",
    displayName: "caisse.bzh",
    publisherDisplayName: "Webdesign29",
    languages: ["fr-FR"],
    backgroundColor: "#102B42",
    minVersion: "10.0.19041.0",
    maxVersionTested: "10.0.26100.0",
    capabilities: ["runFullTrust"],
    addAutoLaunchExtension: false,
    electronUpdaterAware: false,
    setBuildNumber: false,
  },
};
