# Build policy

Run an Android build (EAS cloud or local) only when the user explicitly requests a build. Do not rebuild automatically to implement, test, or troubleshoot changes; Expo build quotas are limited. Prefer the installed development client and Metro for JavaScript changes. Do not install Android SDK/Gradle or other gigabyte-scale tooling without first warning the user.

# Camera and destination

Use only the rear camera on Google Pixel 6a. Do not add front-camera support or switching. Orientation calculations must use the rear camera viewing axis (device -Z). Tendur Kebab is a fixed geographic destination at latitude 52.2402694, longitude 20.9815395; do not generate or reposition it relative to the user.
