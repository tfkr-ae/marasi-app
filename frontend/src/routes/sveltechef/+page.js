import { redirect } from "@sveltejs/kit";

// The CyberChef page used to live here. Saved links keep working.
export function load() {
  redirect(308, "/cyberchef");
}
