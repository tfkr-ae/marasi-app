// The Logbook's severity colours: a badge with the severity's name, and a
// small square mark where a badge would crowd the row.

/** Badge classes per severity, as the old Logbook cards drew them. */
export const SEVERITY_BADGE = {
  Critical: "bg-red-600 text-white",
  High: "bg-orange-500 text-white",
  Medium: "bg-yellow-500 text-black",
  Low: "bg-blue-500 text-white",
  Informational: "bg-green-500 text-white",
};

/** A square mark's colour per severity. */
export const SEVERITY_MARK = {
  Critical: "bg-red-600",
  High: "bg-orange-500",
  Medium: "bg-yellow-500",
  Low: "bg-blue-500",
  Informational: "bg-green-500",
};
