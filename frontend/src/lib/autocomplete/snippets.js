import { snippetCompletion } from "@codemirror/autocomplete";

export const GLOBAL_SNIPPETS = [
    snippetCompletion("function processRequest(req)\n\t${}\nend", {
        label: "processRequest", type: "function", info: "Process outgoing requests"
    }),
    snippetCompletion("function processResponse(res)\n\t${}\nend", {
        label: "processResponse", type: "function", info: "Process incoming responses"
    }),
    snippetCompletion("function interceptRequest(req)\n\t${}\nend", {
        label: "interceptRequest", type: "function", info: "Determine if request should be intercepted"
    }),
    snippetCompletion("function interceptResponse(res)\n\t${}\nend", {
        label: "interceptResponse", type: "function", info: "Determine if response should be intercepted"
    }),
    snippetCompletion("function startup()\n\t${}\nend", {
        label: "startup", type: "function", info: "Function that runs once on startup"
    }),
    snippetCompletion("{\n\ttype = 'button',\n\tvalue = { bind = '${1:bind_path}', default = '${2:label}' },\n\tclasses = '${3:btn variant-filled-primary}', --optional\n\ticon = { name = '${4:Activity}', size = ${5:20} }, --optional\n\ton_click = '${6:function_name}' --optional\n}", {
        label: "guibutton",
        type: "namespace",
        info: "Button GUI component with Wails event binding and Lucide icon support."
    }),
    snippetCompletion("{\n\ttype = 'button-group',\n\tclasses = '${1:btn-group horizontal variant-filled-primary}', --optional\n\tchildren = {\n\t\t${0}\n\t}\n}", {
        label: "guibuttongroup",
        type: "namespace",
        info: "Container component that provides context for grouped buttons"
    }),
    snippetCompletion("{\n\ttype = 'checkbox',\n\tvalue = { bind = '${1:bind_variable}', default = ${2:false} },\n\tclasses = '${3:checkbox checkbox-primary}', --optional\n\tdisabled = ${4:false} --optional\n}", {
        label: "guicheckbox",
        type: "namespace",
        info: "Checkbox component with two-way data binding"
    }),
    snippetCompletion("{\n\ttype = 'container',\n\tclasses = '${1:max-w-full}', --optional\n\tchildren = {\n\t\t${0}\n\t}\n}", {
        label: "guicontainer",
        type: "namespace",
        info: "General purpose container wrapper"
    }),
    snippetCompletion("{\n\ttype = 'drawer',\n\tlabel = '${1:Open Drawer}', --optional\n\ttriggerClasses = '${2:btn btn-primary}', --optional\n\ticon = { name = '${3:Activity}', size = ${4:18} }, --optional\n\ttitle = '${5:Drawer}', --optional\n\tbodySchema = {\n\t\t${6:}\n\t}, --optional\n\tposition = '${7:right}', --optional\n\twidth = '${8:w-[280px] md:w-[480px]}', --optional\n\theight = '${9:h-full}', --optional\n\tpadding = '${10:p-4}', --optional\n\trounded = '${11:rounded-none}' --optional\n}", {
        label: "guidrawer",
        type: "namespace",
        info: "Trigger button that opens a configured side drawer"
    }),
    snippetCompletion("{\n\ttype = 'editor',\n\tvalue = { bind = '${1:bind_variable}' },\n\treadonly = ${2:false}, --optional\n\tplaceholder = '${3:Enter code...}', --optional\n\tclasses = '${4:}', --optional\n\tlang = '${5:http}', --optional (http | javascript)\n\tstyles = {\n\t\twidth = '${6:100%}',\n\t\theight = '${7:5rem}',\n\t\t['min-height'] = '${8:100px}'\n\t} --optional\n}", {
        label: "guieditor",
        type: "namespace",
        info: "CodeMirror editor component with syntax highlighting and VIM support"
    }),
    snippetCompletion("{\n\ttype = 'h-stack',\n\tclasses = '${1:flex flex-row flex-wrap gap-4 items-center justify-start}', --optional\n\tchildren = {\n\t\t${0}\n\t}\n}", {
        label: "guihstack",
        type: "namespace",
        info: "Horizontal flexbox container for layout"
    }),
    snippetCompletion("{\n\ttype = 'icon',\n\ticon = '${1:Activity}', --optional\n\tsvg = '${2:}', --optional\n\tsize = ${3:24}, --optional\n\tclasses = '${4:}' --optional\n}", {
        label: "guiicon",
        type: "namespace",
        info: "Icon component supporting Lucide icons or raw sanitized SVG strings"
    }),
    snippetCompletion("{\n\ttype = 'input',\n\tvalue = { bind = '${1:bind_variable}' },\n\tlabel = '${2:Label Text}', --optional\n\tplaceholder = '${3:Enter text...}', --optional\n\tvalidation = { type = '${4:text}', customError = '${5:Invalid input}' }, --optional (text | number)\n\tclasses = '${6:flex flex-col w-full}', --optional\n\tdisabled = ${7:false} --optional\n}", {
        label: "guiinput",
        type: "namespace",
        info: "Text or Number input field with debounced binding and validation support"
    }),
    snippetCompletion("{\n\ttype = 'label',\n\tvalue = { bind = '${1:bind_variable}', default = '${2:Label Text}' },\n\tclasses = '${3:text-sm font-medium opacity-70 ml-1}' --optional\n}", {
        label: "guilabel",
        type: "namespace",
        info: "Text label component with reactive data binding"
    }),
    snippetCompletion("{\n\ttype = 'modal',\n\tlabel = '${1:Open Modal}', --optional\n\ttriggerClasses = '${2:btn btn-primary}', --optional\n\ticon = '${3:}', --optional\n\ttitle = '${4:Modal Title}', --optional\n\tbodySchema = {\n\t\t${5:}\n\t}, --optional\n\tbackdropClasses = '${6:}' --optional\n}", {
        label: "guimodal",
        type: "namespace",
        info: "Trigger button that opens a Skeleton modal with a custom schema body"
    }),
    snippetCompletion("{\n\ttype = 'progress-radial',\n\tvalue = { bind = '${1:bind_variable}', default = ${2:true} },\n\twidth = '${3:w-24}', --optional\n\tfont = ${4:10}, --optional\n\tstroke = ${5:30} --optional\n}", {
        label: "guiprogressradial",
        type: "namespace",
        info: "Indeterminate radial progress indicator with visibility binding"
    }),
    snippetCompletion("{\n\ttype = 'radio',\n\tvalue = { bind = '${1:group_variable}' },\n\tchoiceValue = '${2:option_value}',\n\tname = '${3:radio_group_name}',\n\tclasses = '${4:radio radio-primary}', --optional\n\tdisabled = ${5:false} --optional\n}", {
        label: "guiradio",
        type: "namespace",
        info: "Radio input component for selecting a single value from a group"
    }),
    snippetCompletion("{\n\ttype = 'select',\n\tvalue = { bind = '${1:bind_variable}' },\n\toptions = {\n\t\t{ label = '${2:Option 1}', value = '${3:val1}' },\n\t\t${4:}\n\t},\n\tclasses = '${5:select select-bordered w-full p-2}', --optional\n\tdisabled = ${6:false}, --optional\n\tmultiple = ${7:false}, --optional\n\tsize = ${8:1} --optional\n}", {
        label: "guiselect",
        type: "namespace",
        info: "Select dropdown component supporting single or multiple selection and object-based options"
    }),
    snippetCompletion("{\n\ttype = 'table',\n\tvalue = { bind = '${1:data_variable}' },\n\tcolumns = {\n\t\t{ header = '${2:ID}', accessorKey = '${3:id}', sortable = ${4:true} },\n\t\t{ header = '${5:Name}', accessorKey = '${6:name}', sortable = ${7:true} },\n\t\t${8:}\n\t},\n\temptyMessage = '${9:No records found.}', --optional\n\ttableClass = '${10:table max-w-full border-collapse}', --optional\n\theaderClass = '${11:bg-base-200}', --optional\n\trowClass = '${12:hover:bg-base-100 border-t border-base-200}' --optional\n}", {
        label: "guitable",
        type: "namespace",
        info: "TanStack data table with sorting and reactive data binding"
    }),
    snippetCompletion("{\n\ttype = 'tabs',\n\titems = {\n\t\t{ label = '${1:General}', value = '${2:general}', panel = {\n\t\t\t${3:}\n\t\t} },\n\t\t{ label = '${4:Settings}', value = '${5:settings}', panel = {\n\t\t\t${6:}\n\t\t} }\n\t},\n\tclasses = '${7:w-full}' --optional\n}", {
        label: "guitabs",
        type: "namespace",
        info: "Tabbed navigation component with schema-based panel rendering"
    }),
    snippetCompletion("{\n\ttype = 'text',\n\tvalue = { bind = '${1:bind_variable}' },\n\ttag = '${2:p}', --optional (h1-h6 | p | span | strong | em | small | code | pre | blockquote | label),\n\tclasses = '${3:}' --optional\n}", {
        label: "guitext",
        type: "namespace",
        info: "Reactive text component that renders a specific HTML element based on a bind value"
    }),
    snippetCompletion("{\n\ttype = 'textarea',\n\tvalue = { bind = '${1:bind_variable}' },\n\tplaceholder = '${2:Enter text...}', --optional\n\trows = ${3:5}, --optional\n\tcols = ${4:10}, --optional\n\tclasses = '${5:textarea textarea-bordered w-full p-2 focus:outline-none focus:ring-2 focus:ring-primary-500}', --optional\n\tdisabled = ${6:false}, --optional\n\treadonly = ${7:false} --optional\n}", {
        label: "guitextarea",
        type: "namespace",
        info: "Multi-line text input with debounced data binding"
    }),
    snippetCompletion("{\n\ttype = 'v-stack',\n\tclasses = '${1:flex flex-col gap-4 items-stretch justify-start}', --optional\n\tchildren = {\n\t\t${0}\n\t}\n}", {
        label: "guivstack",
        type: "namespace",
        info: "Vertical flexbox container for layout"
    }),
    snippetCompletion("{\n\tname = '${1:Menu Item}',\n\tsubtitle = '${2:}', --optional\n\tkeywords = '${3:}', --optional\n\ticon = '${4:Activity}', --optional\n\taction = '${5:function_name}',\n\tkeys = { '${6:⌘+shift+m}', '${7:ctrl+shift+m}' } --optional (macOS first, then windows/linux)\n}", {
        label: "guimenuitem",
        type: "namespace",
        info: "Command menu item that triggers a specific extension function (Options handled internally)"
    }),
    snippetCompletion("{\n\ttype = 'toast',\n\tmessage = '${1:Notification message}',\n\tvariant = '${2:primary}' --optional (primary | secondary | tertiary | success | warning | error | surface)\n}", {
        label: "guitoast",
        type: "namespace",
        info: "Triggers a Skeleton UI toast notification with specified theme variant"
    })
];
