frappe.provide("nexlify_reports.list_resize");

(function () {
	const MIN_COL_WIDTH = 50;
	const SETTINGS_KEY = "nexlify_col_widths";
	const cache = {};
	const applied = {};

	function scope(doctype) {
		return '.frappe-list[data-nexlify-doctype="' + doctype.replace(/"/g, '\\"') + '"]';
	}

	function current() {
		const route = frappe.get_route();
		if (route[0] !== "List" || (route[2] && route[2] !== "List")) return null;
		if (!window.cur_list || cur_list.doctype !== route[1] || !cur_list.$result) return null;
		const wrap = cur_list.$result.closest(".frappe-list")[0];
		if (!wrap) return null;
		if (wrap.getAttribute("data-nexlify-doctype") !== cur_list.doctype) {
			wrap.setAttribute("data-nexlify-doctype", cur_list.doctype);
		}
		return { doctype: cur_list.doctype, wrap: wrap };
	}

	function load_widths(doctype) {
		if (cache[doctype]) return Object.assign({}, cache[doctype]);
		const s = frappe.model.user_settings[doctype];
		return Object.assign({}, (s && s.List && s.List[SETTINGS_KEY]) || {});
	}

	function save_widths(doctype, widths) {
		cache[doctype] = Object.assign({}, widths);
		try {
			frappe.model.user_settings.save(doctype, "List", { [SETTINGS_KEY]: widths });
		} catch (e) {}
	}

	function style_tag(doctype) {
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
		const sel = scope(doctype);
		const keys = Object.keys(widths);
		let css = "";
		if (keys.length) {
			css += sel + " .result-container { overflow-x: auto !important; }\n";
			css += sel + " .list-row-container { width: max-content; min-width: 100%; }\n";
			css += sel + " .list-row-container .level-left { flex: 0 0 auto !important; max-width: none !important; overflow: visible !important; }\n";
		}
		keys.forEach(function (idx) {
			const w = widths[idx];
			css += sel + " .list-row-container .level-left > .list-row-col:nth-child(" + idx + ") " +
				"{ flex: 0 0 " + w + "px !important; width: " + w + "px !important; " +
				"min-width: " + w + "px !important; max-width: " + w + "px !important; }\n";
		});
		style_tag(doctype).textContent = css;
	}

	function header_cols(wrap) {
		return wrap.querySelectorAll(".list-row-head .list-header-subject > .list-row-col");
	}

	function ensure_handles(doctype, wrap) {
		const cols = header_cols(wrap);
		cols.forEach(function (col, i) {
			if (i === cols.length - 1) return;
			if (col.querySelector(".nexlify-list-resize-handle")) return;

			col.style.position = "relative";
			const handle = document.createElement("div");
			handle.className = "nexlify-list-resize-handle";
			handle.title = __("Drag to resize, double-click to reset all");
			col.appendChild(handle);

			handle.addEventListener("click", function (e) { e.stopPropagation(); });

			handle.addEventListener("dblclick", function (e) {
				e.preventDefault();
				e.stopPropagation();
				save_widths(doctype, {});
				apply_widths(doctype, {});
			});

			handle.addEventListener("mousedown", function (e) {
				e.preventDefault();
				e.stopPropagation();

				// freeze every visible column at its current width, so only this one changes
				const widths = load_widths(doctype);
				header_cols(wrap).forEach(function (c, j) {
					const w = Math.round(c.getBoundingClientRect().width);
					if (w > 0 && !widths[j + 1]) widths[j + 1] = w;
				});

				const colIndex = i + 1;
				const startX = e.pageX;
				const startWidth = col.getBoundingClientRect().width;
				apply_widths(doctype, widths);
				document.body.classList.add("nexlify-col-resizing");

				function on_move(ev) {
					widths[colIndex] = Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.pageX - startX));
					apply_widths(doctype, widths);
				}
				function on_up() {
					document.removeEventListener("mousemove", on_move);
					document.removeEventListener("mouseup", on_up);
					document.body.classList.remove("nexlify-col-resizing");
					save_widths(doctype, widths);
				}
				document.addEventListener("mousemove", on_move);
				document.addEventListener("mouseup", on_up);
			});
		});
	}

	function sync() {
		const c = current();
		if (!c) return;
		if (!applied[c.doctype]) {
			applied[c.doctype] = true;
			apply_widths(c.doctype, load_widths(c.doctype));
		}
		ensure_handles(c.doctype, c.wrap);
	}

	let timer = null;
	const observer = new MutationObserver(function () {
		clearTimeout(timer);
		timer = setTimeout(sync, 120);
	});

	$(function () {
		observer.observe(document.body, { childList: true, subtree: true });
		sync();
	});
	frappe.router.on("change", function () { setTimeout(sync, 300); });
})();
