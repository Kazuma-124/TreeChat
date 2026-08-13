import { MODELS } from '../api';

export default function ModelSelector({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <label className="model-select">
      模型
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {MODELS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );
}
