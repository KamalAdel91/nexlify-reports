import frappe


def boot_session(bootinfo):
	# Expose the kill-switch to every desk page. Missing/uninstalled
	# settings default to ENABLED (fail-open).
	try:
		bootinfo.nexlify_reports_enabled = frappe.db.get_single_value(
			"Nexlify Reports Settings", "enabled"
		)
	except Exception:
		bootinfo.nexlify_reports_enabled = 1
