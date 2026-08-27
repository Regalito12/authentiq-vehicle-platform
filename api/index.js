// Vercel entrypoint for the Express API when the project root is the repository.
// The repository root has no package.json with `type: module`, so Vercel loads
// this function as CommonJS. Load the ESM Express app lazily and keep the
// handler cached for warm invocations.
let appPromise;

module.exports = async function vercelApiHandler(req, res) {
  appPromise ||= import("../app/server/src/index.js").then(({ default: app }) => app);
  const app = await appPromise;
  return app(req, res);
};
