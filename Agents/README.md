# Role Designer — instalación y despliegue en Azure SRE Agent

**Role Designer** es un agente personalizado de [Azure SRE Agent](https://sre.azure.com) que diseña, revisa, ajusta y audita **roles personalizados de Azure RBAC y de Microsoft Entra ID** con el principio de mínimo privilegio. Cada permiso que propone va justificado con evidencia (tarea pedida, Activity Log o dependencia documentada) y nunca crea ni modifica un rol sin aprobación explícita.

Funciona con dos piezas que se instalan por separado:

| Pieza | Ruta en el repo | Qué aporta |
|---|---|---|
| Skill `azure-custom-role-designer` | [`Skills/azure-custom-role-designer/`](../Skills/azure-custom-role-designer/) | El método: flujo de 6 pasos, reglas de diseño, revisión de riesgos, comandos y errores conocidos |
| Agente `role_designer` | [`Agents/role_designer.agent.yaml`](role_designer.agent.yaml) | El especialista: instrucciones, formato de respuesta fijo, herramientas y skill asignados |

No necesita ningún conector MCP: consulta Microsoft Graph directamente con comandos `az ad` de solo lectura.

---

## Contenido

```text
Agents/
├── README.md                          ← este documento
└── role_designer.agent.yaml           ← definición del agente (pegar en la pestaña YAML)
Skills/
└── azure-custom-role-designer/
    ├── SKILL.md                       ← instrucciones del skill (pegar en el editor)
    ├── azure-custom-role.template.json
    ├── entra-custom-role.template.json
    └── examples/
        ├── update-role.example.json             ← formato correcto para az role definition update
        ├── sre-agent-mi-rightsizing.md          ← ejemplo real de ajuste de una identidad
        └── RACARB-SREAgent-ArcDemoVMOperator.json
```

Los ejemplos de `examples/` vienen del entorno original; sirven de referencia y no hay que adaptarlos.

---

## Requisitos previos

| Requisito | Para qué | Obligatorio |
|---|---|---|
| Un Azure SRE Agent desplegado | Donde se instala el agente | Sí |
| Rol **SRE Agent Administrator** para quien instala | Crear skills y agentes, y aprobar acciones | Sí |
| **Reader** de la identidad del agente en las suscripciones a analizar | Leer roles, asignaciones, operaciones de proveedores y Activity Log | Sí |
| Permiso de Graph **`Directory.Read.All`** (aplicación) para la identidad del agente | Consultas `az ad` a usuarios, grupos y service principals | Sí, si `az ad` devuelve 403 |
| `Microsoft.Authorization/roleDefinitions/read` y `write` en el ámbito | Que el agente cree o actualice roles de Azure (siempre con aprobación) | Opcional (ver paso 1.3) |
| Microsoft Entra ID **P1** | Roles personalizados de Entra ID | Solo para roles de Entra |
| Microsoft Entra ID **P2** (incluido en E5) | Asignaciones elegibles con PIM | Solo si se usa PIM |

---

## Paso 1. Preparar la identidad del agente

### 1.1 Obtener la identidad

```bash
az resource show \
  --ids /subscriptions/<SUB_ID>/resourceGroups/<RG_AGENTE>/providers/Microsoft.App/agents/<NOMBRE_AGENTE> \
  --query "{type:identity.type, systemPrincipalId:identity.principalId, userAssigned:identity.userAssignedIdentities}" -o json
```

Apunta el `principalId` (object ID) de la identidad que usa el agente. Si tiene identidad asignada por el usuario, normalmente es esa. En los pasos siguientes la llamamos `<MI_OBJECT_ID>`.

### 1.2 Lectura en Azure

```bash
az role assignment create --assignee-object-id <MI_OBJECT_ID> --assignee-principal-type ServicePrincipal \
  --role Reader --scope /subscriptions/<SUB_ID>
```

Repite el comando para cada suscripción que quieras analizar, o asígnalo en un grupo de administración.

### 1.3 Creación de roles (opcional)

Decide quién crea los roles:

- **Una persona crea los roles (recomendado):** el agente diseña el rol y entrega el JSON y el comando; alguien con permisos lo ejecuta. No hace falta conceder nada más.
- **El agente crea los roles tras la aprobación:** concede a la identidad un rol personalizado mínimo en el ámbito donde se vayan a crear roles.

```bash
az role definition create --role-definition '{
  "Name": "<ORG>-RoleDefinitionWriter",
  "IsCustom": true,
  "Description": "Create and update custom role definitions. No delete, no role assignments.",
  "Actions": ["Microsoft.Authorization/roleDefinitions/read", "Microsoft.Authorization/roleDefinitions/write"],
  "NotActions": [], "DataActions": [], "NotDataActions": [],
  "AssignableScopes": ["/subscriptions/<SUB_ID>"]
}'
az role assignment create --assignee-object-id <MI_OBJECT_ID> --assignee-principal-type ServicePrincipal \
  --role "<ORG>-RoleDefinitionWriter" --scope /subscriptions/<SUB_ID>
```

`roleDefinitions/write` es un permiso sensible: quien lo tiene puede crear roles con cualquier permiso. Limita su ámbito y mantén la política de aprobación del paso 4.

### 1.4 Lectura de Microsoft Graph

Ejecútalo como Global Administrator o Privileged Role Administrator, solo si las consultas `az ad` del agente devuelven 403 o `Authorization_RequestDenied`:

```bash
MI=<MI_OBJECT_ID>
GRAPH_SP=$(az ad sp show --id 00000003-0000-0000-c000-000000000000 --query id -o tsv)
# 7ab1d382-f21e-4acd-a863-ba3e13f7da61 = Directory.Read.All (aplicación)
az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$MI/appRoleAssignments" \
  --body "{\"principalId\":\"$MI\",\"resourceId\":\"$GRAPH_SP\",\"appRoleId\":\"7ab1d382-f21e-4acd-a863-ba3e13f7da61\"}"
```

No concedas permisos de escritura de Graph (`User.ReadWrite.All`, `Group.ReadWrite.All`, …). El agente no los usa: los cambios en Entra ID se entregan siempre como scripts para que los ejecute una persona.

---

## Paso 2. Crear el skill (siempre antes que el agente)

1. Ve a **sre.azure.com → tu agente → Builder → Create → Skill**.
2. **Name:** `azure-custom-role-designer`. Tiene que ser exactamente este nombre, porque el agente lo referencia así.
3. **Description:** copia la línea `description` de la cabecera de `SKILL.md`. El agente usa este texto para decidir cuándo activar el skill.
4. **Editor:** pega el contenido completo de [`SKILL.md`](../Skills/azure-custom-role-designer/SKILL.md).
5. **Files:** usa **Upload folder** para subir los dos `*.template.json` y la carpeta `examples/` con los mismos nombres, porque `SKILL.md` los menciona.
6. **Tools:** déjalo vacío; las herramientas van en el agente.
7. Pulsa **Create**. El skill aparece en la pestaña **Skills** del Agent Canvas.

---

## Paso 3. Crear el agente

1. Ve a **Builder → Agent Canvas → Create → Custom agent**.
2. Abre la pestaña **YAML**, borra el contenido y pega [`role_designer.agent.yaml`](role_designer.agent.yaml) completo.
3. Cambia a la pestaña **Form** y comprueba:
   - **Custom agent name:** `role_designer`
   - **Instructions:** rellenas
   - **Skills:** `azure-custom-role-designer`
   - **Tools:** `RunAzCliReadCommands`, `GetAzCliHelp`, `RunAzCliWriteCommands`
4. Pulsa **Create**. El agente aparece como un nodo en el Agent Canvas.

Si la pestaña YAML da error, crea el agente desde **Form**: pon el nombre, pega el texto de `system_prompt` en **Instructions** y elige el skill y las herramientas en los selectores.

---

## Paso 4. Garantizar la aprobación antes de cualquier cambio

El YAML lleva `agent_type: Autonomous` porque así lo exporta el editor. En las pruebas, el agente pidió aprobación igualmente antes de `az role definition create`, pero no confíes solo en eso:

1. **Settings → Tool access policies → Global → Ask** con el patrón `RunAzCliWriteCommands`.
2. **Settings → Basics:** deja el modo por defecto del agente en **Review**. Con el modo Autonomous, una regla *Ask* se aprueba sola.

Solo los **SRE Agent Administrators** pueden aprobar.

---

## Paso 5. Probar en el playground

Ve a **Agent Canvas → Test playground** y selecciona `role_designer`. Los hilos de prueba son de solo lectura.

| Prompt de prueba | Resultado esperado |
|---|---|
| "Necesito que alguien reinicie VMs en `<rg>`" | Recomienda el rol integrado **Virtual Machine Contributor** o uno personalizado más pequeño, explicando la diferencia |
| "Ajusta los permisos de la identidad `<nombre o appId>`" | Resuelve el object ID con `az ad sp show`, analiza el Activity Log en tramos de 10 días y compara con sus roles actuales |
| "Un rol que solo pueda restablecer contraseñas en la AU `<nombre>`" | Rol de Entra: propone el integrado **Password Administrator** con ámbito de unidad administrativa y entrega un script (no lo ejecuta) |
| "Audita los roles personalizados de la suscripción `<SUB>`" | Informe de solo lectura: comodines, acciones de escalada, ámbitos amplios, roles sin asignar, duplicados de roles integrados |
| "Crea ese rol" (en un hilo normal) | Muestra la tarjeta **Approve/Deny** antes de ejecutar nada |

Cada respuesta de diseño debe seguir el formato de 6 partes: resumen, JSON del rol, por qué cada acción, revisión de riesgos, despliegue y siguientes pasos. Si no lo hace, ajusta `system_prompt` o `SKILL.md` y vuelve a probar.

---

## Paso 6. Uso diario

- **En el chat:** abre un hilo nuevo, escribe `/agent`, elige `role_designer` y haz la petición en lenguaje natural. El agente ve el contexto previo del hilo.
- **Sin `/agent`:** el skill también está disponible para el agente principal, pero `role_designer` garantiza el formato y las herramientas restringidas.
- **Auditoría periódica:** crea una tarea programada, por ejemplo mensual, con el prompt *"Audita los roles personalizados de la suscripción `<SUB>` y publica el resultado en Teams"* asignada a `role_designer`, en modo Review.

---

## Actualizar a una nueva versión

1. **Skill:** Builder → Skills → `azure-custom-role-designer` → **Edit**. Pega el nuevo `SKILL.md`, sube los ficheros que cambien y pulsa **Save**.
2. **Agente:** Agent Canvas → nodo `role_designer` → **Edit** → pestaña **YAML**. Pega el nuevo YAML y pulsa **Save**.
3. **Registro:** tras guardar, copia el YAML que muestra el editor al repositorio, para que el repo refleje siempre lo que hay desplegado.

---

## Solución de problemas

Todos estos errores aparecieron durante el desarrollo y están verificados.

| Error | Causa | Solución |
|---|---|---|
| `Invalid YAML: Failed to locate agent specification in YAML` | YAML plano (`name`, `system_prompt` en la raíz) | Usa el formato `api_version: azuresre.ai/v1` / `kind: AgentConfiguration` / `spec:` de este repo |
| `This field is required` en la pestaña YAML | Formato `azuresre.ai/v2` / `kind: ExtendedAgent` | Mismo formato v1 o crea el agente desde **Form** |
| El skill no aparece en **Choose skills** | El skill no existe o tiene otro nombre | Crea el skill primero (paso 2) con el nombre exacto |
| `KeyError: 'roleName'` en `az role definition update` | JSON en formato de creación (`Name`/`Id`) | Usa el formato de [`examples/update-role.example.json`](../Skills/azure-custom-role-designer/examples/update-role.example.json) (`roleName` + `id` completo) |
| `ValidationError` al usar `az rest` | `az rest` no está permitido en las herramientas del agente | Es intencionado: el agente entrega el script al usuario |
| `az ad …` devuelve 403 / `Authorization_RequestDenied` | La identidad no puede leer Graph | Paso 1.4 (`Directory.Read.All`) |
| Activity Log: `exit code 124` o resultado vacío | Ventana demasiado larga o `--max-events` truncado | Tramos de 10 días con `--caller <objectId>`; las identidades administradas aparecen como **object ID** |
| `BadRequest: start time cannot be more than 90 days` | El Activity Log guarda 90 días | Limita la ventana a 90 días |
| `RoleAssignmentExists` al crear una elegibilidad PIM | Ya existe la elegibilidad | Usa `AdminExtend` / `AdminUpdate` |
| `RoleAssignmentRequestPolicyValidationFailed` | La configuración PIM del rol no permite elegibilidad permanente | Usa una duración (p. ej. `P365D`) o cambia la configuración del rol de forma consciente |
| El agente crea un rol sin pedir aprobación | Falta la política del paso 4 o el modo es Autonomous | Aplica el paso 4 y repite la prueba |

---

## Limitaciones conocidas

- **Roles de Entra y PIM no se pueden leer desde el agente:** las definiciones y asignaciones de roles de Entra ID y las programaciones de PIM no tienen comando `az ad`, y `az rest` está bloqueado. El agente pide al usuario que ejecute un script de Microsoft Graph PowerShell y le pegue la salida.
- **Toda escritura en Entra o PIM es manual:** crear roles de Entra, asignar roles y crear elegibilidades PIM se entrega siempre como script.
- **Lo que no ve el Activity Log:** no registra lecturas y solo guarda 90 días, así que las necesidades de lectura se deducen.
- **Nunca borra:** el agente no elimina roles ni asignaciones; solo lo recomienda.

---

## Desinstalar

1. Agent Canvas → nodo `role_designer` → elimínalo.
2. Builder → Skills → `azure-custom-role-designer` → elimínalo.
3. Revoca los permisos concedidos en el paso 1 que ya no se necesiten (rol `<ORG>-RoleDefinitionWriter`, `Directory.Read.All`).
