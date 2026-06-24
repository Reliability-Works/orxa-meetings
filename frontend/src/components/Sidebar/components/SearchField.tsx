import { SearchIcon, X } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../../ui/input-group";

interface SearchFieldProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

export function SearchField({ placeholder, value, onChange, onClear }: SearchFieldProps) {
  return (
    <div className="mb-2 px-1">
      <InputGroup>
        <InputGroupInput
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        {value && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={onClear}>
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  );
}
