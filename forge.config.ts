import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon:
      process.platform === "win32"
        ? "src/icons/windows/icon.ico"
        : process.platform === "darwin"
          ? "src/icons/macos/icon.icns"
          : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel(
      {
        title: "Les Jours - Media Converter",
        authors: "Les Jours SAS",
        iconUrl:
          "https://raw.githubusercontent.com/lesjoursfr/media-converter-app/refs/heads/main/src/icons/windows/icon.ico",
        setupIcon: "src/icons/windows/icon.ico",
      },
      ["win32"]
    ),
    new MakerDMG(
      {
        title: "Les Jours - Media Converter",
        icon: "src/icons/macos/icon.icns",
        format: "ULFO",
        overwrite: true,
      },
      ["darwin"]
    ),
    new MakerDeb(
      {
        options: {
          name: "Les Jours - Media Converter",
          maintainer: "Les Jours SAS",
          icon: "src/icons/linux/icons/512x512.png",
        },
      },
      ["linux"]
    ),
    new MakerRpm(
      {
        options: {
          name: "Les Jours - Media Converter",
          icon: "src/icons/linux/icons/512x512.png",
        },
      },
      ["linux"]
    ),
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
