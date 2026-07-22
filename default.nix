{ pkgs ? import
    (fetchTarball {
      name = "jpetrucciani-2026-07-20";
      url = "https://github.com/jpetrucciani/nix/archive/31fe870656eadb142fd1cb18f9d1a2100c1ffe32.tar.gz";
      sha256 = "1k6biif8rcwdn9yqgdlqzp62r5ly5l30sp006gjhcywlq6nzkj49";
    })
    { }
}:
let
  name = "sayless";

  tools = with pkgs; {
    cli = [
      jfmt
      nixup
      codex-latest
      typescript-go
    ];
    scripts = pkgs.lib.attrsets.attrValues scripts;
  };

  scripts = with pkgs; { };
  paths = pkgs.lib.flatten [ (builtins.attrValues tools) ];
  env = pkgs.buildEnv {
    inherit name paths; buildInputs = paths;
  };
in
(env.overrideAttrs (_: {
  inherit name;
  NIXUP = "0.0.10";
})) // { inherit scripts; }
