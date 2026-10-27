#!/usr/bin/env bash
#
# Arma el bundle que se sube a Infrastructure Manager.
#
# Infra Manager sube SOLO el directorio indicado en --local-source y no resuelve
# referencias fuera de él. Por eso el bundle replica el árbol que las rutas
# relativas del código esperan:
#
#   build/<stack>/              ← contenido de despliegues/<ambiente>/<stack>/
#   build/<stack>/plantillas/   ← copia de plantillas/   (raíz → ./plantillas/<stack>)
#   build/<stack>/modulos/      ← copia de modulos/      (plantilla → ../../modulos/<x>)
#
# Uso: scripts/bundle.sh <ambiente> <stack>
#   scripts/bundle.sh des devops

set -euo pipefail

AMBIENTE="${1:-}"
STACK="${2:-}"

if [[ -z "$AMBIENTE" || -z "$STACK" ]]; then
  echo "Uso: $0 <ambiente> <stack>" >&2
  echo "Ejemplo: $0 des devops" >&2
  exit 1
fi

# Raíz del repositorio, independiente del directorio desde el que se invoque
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ORIGEN="$RAIZ/despliegues/$AMBIENTE/$STACK"
DESTINO="$RAIZ/build/$STACK"

if [[ ! -d "$ORIGEN" ]]; then
  echo "Error: no existe la raíz de despliegue $ORIGEN" >&2
  exit 1
fi

# Se reconstruye desde cero para que el bundle nunca arrastre archivos de una
# ejecución anterior (por ejemplo, un .tf que se haya eliminado del repo).
rm -rf "$DESTINO"
mkdir -p "$DESTINO"

cp "$ORIGEN"/* "$DESTINO"/

cp -r "$RAIZ/plantillas" "$DESTINO/plantillas"
cp -r "$RAIZ/modulos" "$DESTINO/modulos"

# Artefactos locales de Terraform que no deben viajar en el bundle
find "$DESTINO" -name '.terraform' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$DESTINO" -name '*.tfstate*' -type f -delete 2>/dev/null || true

echo "Bundle listo: build/$STACK"
