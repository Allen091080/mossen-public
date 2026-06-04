export function getDisplayAppVersion(version = MACRO.VERSION): string {
  const stableMajorMinor = version.match(/^(\d+)\.(\d+)\.0$/)
  if (stableMajorMinor) {
    return `${stableMajorMinor[1]}.${stableMajorMinor[2]}`
  }

  return version
}
