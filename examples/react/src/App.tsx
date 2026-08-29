import { useMemo, useRef, useState } from "react";
import {
  MachTable,
  reactCellRenderer,
  type GridApi,
  type ColDef,
  type CellClickEvent
} from "@agile-team/mach-table-react";

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
  return Array.from({ length: count }, (_, i) => ({
    id: `E${i + 1}`,
    name: `员工-${i + 1}`,
    department: DEPARTMENTS[i % DEPARTMENTS.length],
    salary: 8000 + ((i * 137) % 22000),
    level: LEVELS[i % LEVELS.length]
  }));
}

function SalaryCell(props: { value: number }) {
  const color = props.value > 25000 ? "#dc2626" : props.value > 15000 ? "#d97706" : "#16a34a";
  return <strong style={{ color }}>¥{props.value.toLocaleString()}</strong>;
}

export default function App() {
  const [rowData, setRowData] = useState<Employee[]>(() => makeRows(5000));
  const [selectedCount, setSelectedCount] = useState(0);
  const [clicked, setClicked] = useState("");
  const apiRef = useRef<GridApi<Employee> | null>(null);

  const columnDefs = useMemo<ColDef<Employee>[]>(
    () => [
      { colId: "select", headerName: "", width: 46, checkboxSelection: true, sortable: false, resizable: false, movable: false },
      { field: "id", headerName: "工号", width: 110 },
      { field: "name", headerName: "姓名", flex: 1, editable: true, filter: "text" },
      { field: "department", headerName: "部门", width: 130, filter: "set" },
      {
        field: "salary",
        headerName: "薪资",
        width: 140,
        filter: "number",
        cellRenderer: reactCellRenderer(SalaryCell)
      },
      { field: "level", headerName: "职级", width: 100, editable: true, cellEditor: "select", cellEditorParams: { values: LEVELS } }
    ],
    []
  );

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h3 style={{ marginBottom: 12 }}>MachTable React 集成示例</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setRowData(makeRows(rowData.length + 1000))}>加载更多（+1000）</button>
        <button onClick={() => apiRef.current?.deselectAll()}>清除选择</button>
        <button onClick={() => apiRef.current?.getDataAsCsv() && alert("CSV 已生成，见控制台")}>打印 CSV</button>
        <span style={{ color: "#64748b" }}>选中 {selectedCount} 行 {clicked && `· 点击了 ${clicked}`}</span>
      </div>
      <div style={{ height: "70vh", minHeight: 400 }}>
        <MachTable<Employee>
          apiRef={apiRef}
          columnDefs={columnDefs}
          rowData={rowData}
          rowSelection="multiple"
          editableIndicator="always"
          getRowId={(p) => p.data.id}
          onSelectionChanged={(e) => setSelectedCount(e.selectedRows.length)}
          onCellClicked={(e: CellClickEvent<Employee>) => setClicked(`${e.colDef.field}:${e.value}`)}
          onCellValueChanged={(e) => console.log("cell changed", e.colDef.field, e.newValue)}
        />
      </div>
    </div>
  );
}
