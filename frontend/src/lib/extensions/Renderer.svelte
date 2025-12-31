<script context="module">
    import VStack from "./components/VStack.svelte";
    import HStack from "./components/HStack.svelte";
    import Icon from "./components/Icon.svelte";
    import Text from "./components/Text.svelte";
    import Container from "./components/Container.svelte";
    import Button from "./components/Button.svelte";
    import ButtonGroup from "./components/ButtonGroup.svelte";
    import Input from "./components/Input.svelte";
    import Label from "./components/Label.svelte";
    import TextArea from "./components/TextArea.svelte";
    import Select from "./components/Select.svelte";
    import RadioGroup from "./components/RadioGroup.svelte";
    import CheckBox from "./components/CheckBox.svelte";
    import Table from "./components/Table.svelte";
    import Tabs from "./components/Tabs.svelte";
    import Modal from "./components/ModalTrigger.svelte";
    import DrawerTrigger from "./components/DrawerTrigger.svelte";
    import ProgressRadial from "./components/ProgressRadial.svelte";
    import Editor from "./components/Editor.svelte";

    const registry = {
        "v-stack": VStack,
        "h-stack": HStack,
        "button-group": ButtonGroup,
        container: Container,
        text: Text,
        label: Label,
        icon: Icon,
        button: Button,
        input: Input,
        textarea: TextArea,
        select: Select,
        radio: RadioGroup,
        checkbox: CheckBox,
        table: Table,
        tabs: Tabs,
        modal: Modal,
        drawer: DrawerTrigger,
        "progress-radial": ProgressRadial,
        editor: Editor,
    };

    const containers = ["v-stack", "h-stack", "button-group", "container"];
</script>

<script>
    export let schema;
    export let extensionData;

    $: Component = schema && registry[schema.type];
    $: componentProps = schema
        ? (({ children, type, ...rest }) => rest)(schema)
        : {};
    $: expectsChildren = schema && containers.includes(schema.type);
</script>

{#if Component}
    {#if expectsChildren}
        <svelte:component this={Component} {...componentProps} {extensionData}>
            {#if schema.children && Array.isArray(schema.children)}
                {#each schema.children as child (child.id || child)}
                    <svelte:self schema={child} {extensionData} />
                {/each}
            {/if}
        </svelte:component>
    {:else}
        <svelte:component
            this={Component}
            {...componentProps}
            {extensionData}
        />
    {/if}
{:else if schema}
    <div class="text-error-500 border border-error-500 p-2 text-xs">
        Unknown widget: <strong>{schema.type}</strong>
    </div>
{/if}
