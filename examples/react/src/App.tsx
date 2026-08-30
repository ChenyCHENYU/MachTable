import { useMemo, useState } from "react";
import {
  MachTable,
  MachTableToolbar,
  reactCellRenderer,
  type CellClickEvent,
  type ColDef
} from "@agile-team/mach-table-react";
import { useMachTableController } from "@agile-team/mach-table-react/workflows";

interface Employee {
  id: string;
  name: string;
  department: string;
  salary: number;
  level: string;
}

const DEPARTMENTS = ["研发部", "生产部", "质量部", "安全部", "市场部"];
const LEVELS = ["P4", "P5", "P6", "P7", "M1", "M2"];

function makeRows(count: number): Employee[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `E${index + 1}`,
    name: `员工-${index + 1}`,
    department: DEPARTMENTS[index % DEPARTMENTS.length],
    salary: 8_000 + ((index * 137) % 22_000),
    level: LEVELS[index % LEVELS.length]
  }));
}

function SalaryCell({ value }: { value: number }) {
  const color = value > 25_000 ? "#dc2626" : value > 15_000 ? "#d97706" : "#16a34a";
  return <strong style={{ color }}>¥{value.toLocaleString()}</strong>;
}

export default function App() {
  const [rows, setRows] = useState<Employee[]>(() => makeRows(5_000));
  const [clicked, setClicked] = useState("");
  const controller = useMachTableController<Employee>();
  const columns = useMemo<ColDef<Employee>[]>(() => [
    { colId: "select", headerName: "", width: 46, checkboxSelection: true, sortable: false, resizable: false, movable: false },
    { field: "id", headerName: "工号", width: 110 },
    { field: "name", headerName: "姓名", flex: 1, editable: true, filter: "text" },
    { field: "department", headerName: "部门", width: 130, filter: "set" },
    { field: "salary", headerName: "薪资", width: 140, filter: "number", cellRenderer: reactCellRenderer(SalaryCell) },
    { field: "level", headerName: "职级", width: 100, editable: true, cellEditor: "select", cellEditorParams: { values: LEVELS } }
  ], []);

  return (
    <main style={{ display: "grid", gap: 12, padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>MachTable React 集成示例</h1>
      <MachTableToolbar<Employee>
        api={controller.table.api}
        commands={controller.commands}
        search={controller.search}
        onSearchChange={controller.setSearch}
        loading={controller.busy}
        selectedCount={controller.selectedCount}
        onClearSelection={() => controller.table.apiRef.current?.deselectAll()}
        start={<button onClick={() => setRows(makeRows(rows.length + 1_000))}>追加 1,000 行</button>}
      />
      <div style={{ height: "70vh", minHeight: 400 }}>
        <MachTable<Employee>
          apiRef={controller.table.apiRef}
          preset="crud"
          editType="cell"
          editableIndicator="always"
          columnDefs={columns}
          rowData={rows}
          rowKey="id"
          stateKey="react-employees"
          onCellClicked={(event: CellClickEvent<Employee>) => setClicked(`${event.colDef.field}:${event.value}`)}
        />
      </div>
      {clicked && <small>最近点击：{clicked}</small>}
    </main>
  );
}
