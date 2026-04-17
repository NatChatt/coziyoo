(function () {
  function isInteractive(target) {
    return Boolean(
      target.closest(
        'a, button, input, select, textarea, label, [role="button"], .action-checkbox'
      )
    );
  }

  function bindComplaintRows() {
    var rows = document.querySelectorAll("#result_list tbody tr");
    rows.forEach(function (row) {
      if (row.dataset.complaintRowClickBound === "1") return;

      var link = row.querySelector('a[href*="/admin/complaints/complaints/"][href$="/detail/"]');
      if (!link) return;

      row.dataset.complaintRowClickBound = "1";
      row.style.cursor = "pointer";
      row.tabIndex = 0;

      row.addEventListener("click", function (event) {
        if (isInteractive(event.target)) return;
        window.location.href = link.getAttribute("href");
      });

      row.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        if (isInteractive(event.target)) return;
        event.preventDefault();
        window.location.href = link.getAttribute("href");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindComplaintRows);
  } else {
    bindComplaintRows();
  }
})();
