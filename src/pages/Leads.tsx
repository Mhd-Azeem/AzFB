import { WhatsAppButton } from "../components/WhatsAppButton";
import { whatsappNumber } from "../../shared/whatsapp";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { useState } from "react";
import {
  stages,
  type FormRecord,
  type LeadRecord,
  type ListResult,
} from "../../shared/contracts";
import { useDebounce, useResource } from "../hooks/useResource";
import { downloadExport } from "../api";
import { Empty, ErrorState, Loading, dateTime } from "../components/States";
export function Leads({
  initialStatus = "",
  initialForm = "",
  onOpen,
}: {
  initialStatus?: string;
  initialForm?: string;
  onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(initialStatus),
    [form, setForm] = useState(initialForm),
    [pageId, setPageId] = useState(""),
    [assignedTo, setAssignedTo] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [sort, setSort] = useState("newest"),
    [page, setPage] = useState(1),
    [exportError, setExportError] = useState(""),
    [exporting, setExporting] = useState(false),
    [contactError, setContactError] = useState("");
  const query = useDebounce(q),
    params = new URLSearchParams({
      q: query,
      status,
      form,
      pageId,
      assignedTo,
      from,
      to,
      sort,
      page: String(page),
      pageSize: "25",
    });
  const r = useResource<ListResult<LeadRecord>>(`/leads?${params}`),
    forms = useResource<FormRecord[]>("/forms"),
    members =
      useResource<{ id: string; name: string; disabled: number }[]>("/members");
  const pages = Array.from(
    new Map(
      forms.data?.map((f) => [
        f.page_id,
        { id: f.page_id, name: f.page_name },
      ]) || [],
    ).values(),
  );
  function change(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(1);
  }
  return (
    <section className="panel leads-panel">
      <div className="panel-heading">
        <div>
          <h2>
            All leads{" "}
            <span className="heading-count">{r.data?.total ?? "…"}</span>
          </h2>
          <p>Separate submissions remain separate, even for the same person.</p>
        </div>
        <button
          className="button secondary"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            setExportError("");
            try {
              await downloadExport(params.toString());
            } catch (e) {
              setExportError((e as Error).message);
            } finally {
              setExporting(false);
            }
          }}
        >
          <ArrowDownToLine size={15} />
          {exporting ? "Exporting…" : "Export filtered leads"}
        </button>
      </div>
      <div className="filters">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Search leads"
            placeholder="Name, email, phone, campaign, form, Page…"
            value={q}
            onChange={(e) => change(setQ, e.target.value)}
          />
        </label>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => change(setStatus, e.target.value)}
        >
          <option value="">All statuses</option>
          {stages.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Filter by form"
          value={form}
          onChange={(e) => change(setForm, e.target.value)}
        >
          <option value="">All forms</option>
          {forms.data?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by Page"
          value={pageId}
          onChange={(e) => change(setPageId, e.target.value)}
        >
          <option value="">All Pages</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by agent"
          value={assignedTo}
          onChange={(e) => change(setAssignedTo, e.target.value)}
        >
          <option value="">All agents</option>
          {members.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <label className="date-filter">
          From
          <input
            type="date"
            aria-label="From date"
            value={from}
            onChange={(e) => change(setFrom, e.target.value)}
          />
        </label>
        <label className="date-filter">
          To
          <input
            type="date"
            aria-label="To date"
            value={to}
            onChange={(e) => change(setTo, e.target.value)}
          />
        </label>
        <select
          aria-label="Sort leads"
          value={sort}
          onChange={(e) => change(setSort, e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
        </select>
        <button
          className="text-button"
          onClick={() => {
            setQ("");
            setStatus("");
            setForm("");
            setPageId("");
            setAssignedTo("");
            setFrom("");
            setTo("");
            setPage(1);
          }}
        >
          Clear filters
        </button>
      </div>
      {(forms.error || members.error) && (
        <p className="form-error" role="alert">
          Filter options could not load.{" "}
          <button
            className="text-button"
            onClick={() => {
              forms.reload();
              members.reload();
            }}
          >
            Retry options
          </button>
        </p>
      )}
      {contactError && (
        <p role="alert" className="form-error">
          {contactError}
        </p>
      )}
      {exportError && (
        <p role="alert" className="form-error">
          {exportError}
        </p>
      )}
      {r.error ? (
        <ErrorState error={r.error} retry={r.reload} />
      ) : r.loading ? (
        <Loading />
      ) : !r.data?.items.length ? (
        <Empty title="No leads found">
          <p>
            Try different filters, or connect a Page and sync selected forms.
          </p>
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>LEAD</th>
                <th>FORM / PAGE</th>
                <th>STATUS</th>
                <th>SUBMITTED · UTC</th>
                <th>ASSIGNED</th>
                <th>WHATSAPP</th>
                <th>
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.data.items.map((l, i) => (
                <tr key={l.id}>
                  <td>
                    <button className="lead-name" onClick={() => onOpen(l.id)}>
                      <span className={`person person-${i % 4}`}>
                        {l.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{l.name}</strong>
                        <small>
                          {l.email || l.phone || "No contact supplied"}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    {l.form_name}
                    <small className="campaign">
                      {l.page_name} · {l.campaign || l.source}
                    </small>
                  </td>
                  <td>
                    <span className={`status ${l.status.toLowerCase()}`}>
                      <span />
                      {l.status}
                    </span>
                  </td>
                  <td>{dateTime(l.submitted_at)}</td>
                  <td>
                    {members.data?.find((m) => m.id === l.assigned_to)?.name ||
                      "Unassigned"}
                  </td>
                  <td>
                    <WhatsAppButton
                      leadId={l.id}
                      name={l.name}
                      phone={l.phone}
                      compact
                      onError={setContactError}
                    />
                    {!whatsappNumber(l.phone) && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onOpen(l.id)}
                      >
                        Add / fix number
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`View ${l.name}`}
                      onClick={() => onOpen(l.id)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-footer">
        <span>{r.data?.total || 0} matching leads · Dates are UTC</span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous page"
            disabled={page === 1 || r.loading}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            Page {page} of {Math.max(1, Math.ceil((r.data?.total || 0) / 25))}
          </span>
          <button
            className="icon-button"
            aria-label="Next page"
            disabled={r.loading || page * 25 >= (r.data?.total || 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
