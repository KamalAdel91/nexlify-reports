frappe.provide("nexlify_reports.list_columns");

(function () {
	const HIDE_KEY = "nexlify_hidden_cols";
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

	function load_hidden(doctype) {
		if (cache[doctype]) return cache[doctype].slice();
		const s = frappe.model.user_settings[doctype];
		return ((s && s.List && s.List[HIDE_KEY]) || []).slice();
	}

	function save_hidden(doctype, hidden) {
		cache[doctype] = hidden.slice();
		try {
			frappe.model.user_settings.save(doctype, "List", { [HIDE_KEY]: hidden });
		} catch (e) {}
	}

	function style_tag(doctype) {
		const id = "nexlify-list-hidden-cols-" + doctype.replace(/\s+/g, "_");
		let el = document.getElementById(id);
		if (!el) {
			el = document.createElement("style");
			el.id = id;
			document.head.appendChild(el);
		}
		return el;
	}

	function apply_hidden(doctype, hidden) {
		style_tag(doctype).textContent = hidden.map(function (idx) {
			return scope(doctype) + " .list-row-container .level-left > .list-row-col:nth-child(" + idx + ") { display: none !important; }";
		}).join("\n");
	}

	function columns_info(wrap) {
		const cols = wrap.querySelectorAll(".list-row-head .list-header-subject > .list-row-col");
		const out = [];
		cols.forEach(function (col, i) {
			if (col.classList.contains("hide")) return;
			const span = col.querySelector("[data-sort-by]") || col.querySelector("span:not(.select-like)");
			const label = span ? span.textContent.trim() : "";
			out.push({ idx: i + 1, label: label || col.dataset.fieldname || ("Column " + (i + 1)) });
		});
		return out;
	}

	function show_dialog() {
		const c = current();
		if (!c) return;
		const cols = columns_info(c.wrap);
		const hidden = load_hidden(c.doctype);

		const d = new frappe.ui.Dialog({
			title: __("Edit Columns"),
			fields: cols.map(function (col) {
				return {
					fieldtype: "Check",
					fieldname: "col_" + col.idx,
					label: col.label,
					default: hidden.includes(col.idx) ? 0 : 1
				};
			}),
			primary_action_label: __("Apply"),
			primary_action: function (values) {
				const new_hidden = cols
					.filter(function (col) { return !values["col_" + col.idx]; })
					.map(function (col) { return col.idx; });
				save_hidden(c.doctype, new_hidden);
				apply_hidden(c.doctype, new_hidden);
				d.hide();
			}
		});
		d.show();
	}

	function ensure_button() {
		const page = cur_list.page;
		if (!page || $(page.wrapper).find(".nexlify-columns-btn").length) return;
		page.add_inner_button(__("Columns"), show_dialog).addClass("nexlify-columns-btn");
	}

	function sync() {
		const c = current();
		if (!c) return;
		if (!applied[c.doctype]) {
			applied[c.doctype] = true;
			apply_hidden(c.doctype, load_hidden(c.doctype));
		}
		ensure_button();
	}

	let timer = null;
	const observer = new MutationObserver(function () {
		clearTimeout(timer);
		timer = setTimeout(sync, 150);
	});

	$(function () {
		observer.observe(document.body, { childList: true, subtree: true });
		sync();
	});
	frappe.router.on("change", function () { setTimeout(sync, 300); });
})();
