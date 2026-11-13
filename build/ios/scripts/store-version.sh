#!/bin/sh
# Prints the iOS version (CFBundleShortVersionString) for a release VERSION.
#
# The App Store compares versions number by number, from the left, and each
# upload must be higher than the last. Release versions are dates
# (DD.MM.YYYY), so 5.11.2026 would sort below 29.10.2026. A date becomes
# YYYY.M.D instead; any other version keeps its leading digits and dots.
#
#   29.10.2026                    -> 2026.10.29
#   05.11.2026 (nightly abc1234)  -> 2026.11.5
#   v1.2.3                        -> 1.2.3
set -eu

v=$(printf '%s' "${1:-}" | sed -E 's/^v//; s/[^0-9.].*$//')
case "$v" in
[0-9][0-9].[0-9][0-9].[0-9][0-9][0-9][0-9])
	printf '%s' "$v" | awk -F. '{ printf "%d.%d.%d", $3, $2, $1 }'
	;;
*)
	printf '%s' "$v"
	;;
esac
