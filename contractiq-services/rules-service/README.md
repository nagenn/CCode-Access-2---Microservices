# Rules Service

Owns `compliance_rules.json` and exposes the applicable compliance rules
for review.

## `GET /rules?filename={filename}`

Returns applicable compliance rules for the given contract.

**Response:**

```json
{
  "rules": [
    {
      "id": "string",
      "description": "string",
      "severity": "high" | "medium" | "low"
    }
  ],
  "trace": [...]
}
```

Every contract receives the same universal rule set — rules are not
filtered or branched by contract type or content.
