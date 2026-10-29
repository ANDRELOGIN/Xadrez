const engineBase = new URL("./engine/", self.location.href);
self.Module = self.Module || {};
self.Module.locateFile = (path) => new URL(path, engineBase).href;
importScripts(new URL("stockfish-19-lite-single.js", engineBase).href);