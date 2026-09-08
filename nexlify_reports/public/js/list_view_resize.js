frappe.provide("nexlify_reports.list_resize");

(function () {
	const MIN_COL_WIDTH = 50;
	const SETTINGS_KEY = "nexlify_col_widths";

	function load_widths(doctype) {
		try {
			const settings = frappe.model.user_settings[doctype];
			return (settings && settings.List && settings.List[SETTINGS_KEY]) || {};
		} catch (e) {
			return {};
		}
	}

	function save_widths(doctype, widths) {
		try {
			frappe.model.user_settings.save(doctype, "List", {
				[SETTINGS_KEY]: widths
			});
		} catch (e) {}
	}

	function get_style_tag(doctype) {
		const id = "nexlify-list-col-widths-" + doctype.replace(/\s+/g, "_");
		let el = document.getElementById(id);
		if (!el) {
			el = document.createElement("style");
			el.id = id;
			document.head.appendChild(el);
		}
		return el;
	}

	function apply_widths(doctype, widths) {
		const styleEl = get_style_tag(doctype);
		let css = "";
		Object.keys(widths).forEach(function (idx) {
			css +=
				".list-row-container .level-left > .list-row-col:nth-child(" + idx + ") " +
				"{ flex: 0 0 " + widths[idx] + "px !important; " +
				"width: " + widths[idx] + "px !important; " +
				"max-width: " + widths[idx] + "px !important; }\n";
		});
		styleEl.textContent = css;
	}

	function get_header_columns() {
		return document.querySelectorAll(".list-row-head .list-header-subject > .list-row-col");
	}

	function ensure_handles(doctype) {
		const cols = get_header_columns();
		cols.forEach(function (col, i) {
			if (col.querySelector(".nexlify-list-resize-handle")) return;
			if (i === cols.length - 1) return;

			col.style.position = "relative";
			const handle = document.createElement("div");
			handle.className = "nexlify-list-resize-handle";
			handle.dataset.colIndex = i + 1;
			col.appendChild(handle);

			handle.addEventListener("mousedown", function (e) {
				e.preventDefault();
				e.stopPropagation();
				const colIndex = handle.dataset.colIndex;
				const startX = e.pageX;
				const startWidth = col.getBoundingClientRect().width;

				const currentWidths = load_widths(doctype);
				function on_move(ev) {
					const delta = ev.pageX - startX;
					const newWidth = Math.max(MIN_COL_WIDTH, Math.round(startWidth + delta));
					currentWidths[colIndex] = newWidth;
					apply_widths(doctype, currentWidths);
				}
				function on_up() {
					document.removeEventListener("mousemove", on_move);
					document.removeEventListener("mouseup", on_up);
					save_widths(doctype, currentWidths);
				}
				document.addEventListener("mousemove", on_move);
				document.addEventListener("mouseup", on_up);
			});
		});
	}

	function setup() {
		if (!(window.cur_list && cur_list.doctype)) return;
		const doctype = cur_list.doctype;

		const check = setInterval(function () {
			if (get_header_columns().length) {
				clearInterval(check);
				apply_widths(doctype, load_widths(doctype));
				ensure_handles(doctype);
			}
		}, 150);
		setTimeout(function () { clearInterval(check); }, 5000);
	}

	frappe.router.on("change", function () {
		if (frappe.get_route()[0] === "List") {
			setTimeout(setup, 300);
		}
	});
})();
