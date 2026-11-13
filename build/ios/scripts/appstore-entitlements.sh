#!/bin/sh
# Writes the entitlements an App Store (TestFlight) build signs with, read
# from its provisioning profile, so no team ID lives in the repo. Xcode
# derives the same keys from the profile; this build signs without Xcode.
#
#   build/ios/scripts/appstore-entitlements.sh <profile.mobileprovision> <out.plist>
set -eu

profile=$1
out=$2
P=/usr/libexec/PlistBuddy
decoded=$(mktemp)
trap 'rm -f "$decoded"' EXIT
security cms -D -i "$profile" > "$decoded"

app_id=$($P -c "Print :Entitlements:application-identifier" "$decoded")
team_id=$($P -c "Print :Entitlements:com.apple.developer.team-identifier" "$decoded")

rm -f "$out"
$P -c "Add :application-identifier string $app_id" \
	-c "Add :com.apple.developer.team-identifier string $team_id" \
	-c "Add :get-task-allow bool false" \
	-c "Add :beta-reports-active bool true" \
	"$out" >/dev/null
