import { configuration } from "@codedoc/core";
import { codingBlog } from "@codedoc/coding-blog-plugin";

import { theme } from "./theme";

export const config = configuration({
  theme,
  src: {
    base: "posts",
  },
  dest: {
    namespace: "/joys-of-apex", // --> change this if you want to also deploy to GitHub Pages
    html: "dist",
    assets: process.env.GITHUB_BUILD === "true" ? "dist" : ".",
    bundle: process.env.GITHUB_BUILD === "true" ? "bundle" : "dist/bundle",
    styles: process.env.GITHUB_BUILD === "true" ? "styles" : "dist/styles",
  },
  page: {
    title: {
      base: "Joys Of Apex",
    },
    favicon: "/favicon.ico",
  },
  plugins: [
    codingBlog({
      assets: ["img", "favicon.ico"],
    }),
  ],
  misc: {
    github: {
      repo: "james-coding-blog",
      user: "jamessimone",
    },
  },
});
