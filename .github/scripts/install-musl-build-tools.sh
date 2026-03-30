#!/usr/bin/env bash
set -euo pipefail

: "${TARGET:?TARGET environment variable is required}"
: "${GITHUB_ENV:?GITHUB_ENV environment variable is required}"

apt_update_args=()
if [[ -n "${APT_UPDATE_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  apt_update_args=(${APT_UPDATE_ARGS})
fi

apt_install_args=()
if [[ -n "${APT_INSTALL_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  apt_install_args=(${APT_INSTALL_ARGS})
fi

sudo apt-get update "${apt_update_args[@]}"
sudo apt-get install -y "${apt_install_args[@]}" ca-certificates curl musl-tools pkg-config clang libc++-dev libc++abi-dev lld xz-utils

case "${TARGET}" in
  x86_64-unknown-linux-musl)
    arch="x86_64"
    ;;
  aarch64-unknown-linux-musl)
    arch="aarch64"
    ;;
  *)
    echo "Unexpected musl target: ${TARGET}" >&2
    exit 1
    ;;
esac

if command -v "${arch}-linux-musl-gcc" >/dev/null; then
  musl_linker="$(command -v "${arch}-linux-musl-gcc")"
elif command -v musl-gcc >/dev/null; then
  musl_linker="$(command -v musl-gcc)"
else
  echo "musl gcc not found after install; arch=${arch}" >&2
  exit 1
fi

zig_bin="$(command -v zig)"
zig_target="${TARGET/-unknown-linux-musl/-linux-musl}"
runner_temp="${RUNNER_TEMP:-/tmp}"
tool_root="${runner_temp}/onequery-musl-tools-${TARGET}"
mkdir -p "${tool_root}"

cc="${tool_root}/zigcc"
cxx="${tool_root}/zigcxx"

cat > "${cc}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

args=()
skip_next=0
pending_include=0
for arg in "\$@"; do
  if [[ "\${pending_include}" -eq 1 ]]; then
    pending_include=0
    if [[ "\${arg}" == /usr/include || "\${arg}" == /usr/include/* ]]; then
      args+=("-idirafter" "\${arg}")
    else
      args+=("-I" "\${arg}")
    fi
    continue
  fi

  if [[ "\${skip_next}" -eq 1 ]]; then
    skip_next=0
    continue
  fi

  case "\${arg}" in
    --target)
      skip_next=1
      continue
      ;;
    --target=*|-target=*|-target)
      if [[ "\${arg}" == "-target" ]]; then
        skip_next=1
      fi
      continue
      ;;
    -I)
      pending_include=1
      continue
      ;;
    -I/usr/include|-I/usr/include/*)
      args+=("-idirafter" "\${arg#-I}")
      continue
      ;;
    -Wp,-U_FORTIFY_SOURCE)
      # COMMENT: aws-lc-sys can emit GCC-style forwarded undefines here, but
      # zig cc expects the direct form.
      args+=("-U_FORTIFY_SOURCE")
      continue
      ;;
  esac

  args+=("\${arg}")
done

exec "${zig_bin}" cc -target "${zig_target}" "\${args[@]}"
EOF

cat > "${cxx}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

args=()
skip_next=0
pending_include=0
for arg in "\$@"; do
  if [[ "\${pending_include}" -eq 1 ]]; then
    pending_include=0
    if [[ "\${arg}" == /usr/include || "\${arg}" == /usr/include/* ]]; then
      args+=("-idirafter" "\${arg}")
    else
      args+=("-I" "\${arg}")
    fi
    continue
  fi

  if [[ "\${skip_next}" -eq 1 ]]; then
    skip_next=0
    continue
  fi

  case "\${arg}" in
    --target)
      skip_next=1
      continue
      ;;
    --target=*|-target=*|-target)
      if [[ "\${arg}" == "-target" ]]; then
        skip_next=1
      fi
      continue
      ;;
    -I)
      pending_include=1
      continue
      ;;
    -I/usr/include|-I/usr/include/*)
      args+=("-idirafter" "\${arg#-I}")
      continue
      ;;
    -Wp,-U_FORTIFY_SOURCE)
      # COMMENT: aws-lc-sys can emit GCC-style forwarded undefines here, but
      # zig c++ expects the direct form.
      args+=("-U_FORTIFY_SOURCE")
      continue
      ;;
  esac

  args+=("\${arg}")
done

exec "${zig_bin}" c++ -target "${zig_target}" "\${args[@]}"
EOF

chmod +x "${cc}" "${cxx}"

sysroot="$("${zig_bin}" cc -target "${zig_target}" -print-sysroot 2>/dev/null || true)"
if [[ -n "${sysroot}" && "${sysroot}" != "/" ]]; then
  echo "BORING_BSSL_SYSROOT=${sysroot}" >> "$GITHUB_ENV"
  boring_sysroot_var="BORING_BSSL_SYSROOT_${TARGET}"
  boring_sysroot_var="${boring_sysroot_var//-/_}"
  echo "${boring_sysroot_var}=${sysroot}" >> "$GITHUB_ENV"
fi

cflags="-pthread"
cxxflags="-pthread"
if [[ "${TARGET}" == "aarch64-unknown-linux-musl" ]]; then
  # COMMENT: clang on arm64 musl can promote this aws-lc warning to an error.
  cflags="${cflags} -Wno-error=frame-larger-than"
  cxxflags="${cxxflags} -Wno-error=frame-larger-than"
fi

echo "CFLAGS=${cflags}" >> "$GITHUB_ENV"
echo "CXXFLAGS=${cxxflags}" >> "$GITHUB_ENV"
echo "CC=${cc}" >> "$GITHUB_ENV"
echo "TARGET_CC=${cc}" >> "$GITHUB_ENV"
target_cc_var="CC_${TARGET}"
target_cc_var="${target_cc_var//-/_}"
echo "${target_cc_var}=${cc}" >> "$GITHUB_ENV"
echo "CXX=${cxx}" >> "$GITHUB_ENV"
echo "TARGET_CXX=${cxx}" >> "$GITHUB_ENV"
target_cxx_var="CXX_${TARGET}"
target_cxx_var="${target_cxx_var//-/_}"
echo "${target_cxx_var}=${cxx}" >> "$GITHUB_ENV"

cargo_linker_var="CARGO_TARGET_${TARGET^^}_LINKER"
cargo_linker_var="${cargo_linker_var//-/_}"
echo "${cargo_linker_var}=${musl_linker}" >> "$GITHUB_ENV"

echo "CMAKE_C_COMPILER=${cc}" >> "$GITHUB_ENV"
echo "CMAKE_CXX_COMPILER=${cxx}" >> "$GITHUB_ENV"
echo "CMAKE_ARGS=-DCMAKE_HAVE_THREADS_LIBRARY=1 -DCMAKE_USE_PTHREADS_INIT=1 -DCMAKE_THREAD_LIBS_INIT=-pthread -DTHREADS_PREFER_PTHREAD_FLAG=ON" >> "$GITHUB_ENV"
echo "PKG_CONFIG_ALLOW_CROSS=1" >> "$GITHUB_ENV"

if [[ -n "${sysroot}" && "${sysroot}" != "/" ]]; then
  echo "PKG_CONFIG_SYSROOT_DIR=${sysroot}" >> "$GITHUB_ENV"
  pkg_config_sysroot_var="PKG_CONFIG_SYSROOT_DIR_${TARGET}"
  pkg_config_sysroot_var="${pkg_config_sysroot_var//-/_}"
  echo "${pkg_config_sysroot_var}=${sysroot}" >> "$GITHUB_ENV"
fi
