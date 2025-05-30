<script>
    import { page } from '$app/stores';
    import { afterUpdate, onDestroy, onMount} from 'svelte';
    import { EventsOn, EventsOff } from '../../../lib/wailsjs/runtime/runtime';
    import { GetExtensionUI } from '../../../lib/wailsjs/go/main/App';
    import { proxyItems } from '../../../stores';
    import WebComponentWrapper from '../../../lib/components/WebComponentWrapper.svelte';
    import { Accordion, AccordionItem } from '@skeletonlabs/skeleton';
    import { SettingsIcon } from "svelte-feather-icons";
    let props = {
        "name": $page.params.slug
    };
</script>
<Accordion rounded="false">
	<AccordionItem>
		<svelte:fragment slot="lead"><SettingsIcon/></svelte:fragment>
		<svelte:fragment slot="summary">{$page.params.slug} Settings</svelte:fragment>
		<svelte:fragment slot="content">
            <WebComponentWrapper extensionName={$page.params.slug} type="settings"></WebComponentWrapper>
        </svelte:fragment>
	</AccordionItem>
	<!-- ... -->
</Accordion>
<WebComponentWrapper extensionName={$page.params.slug} elementProps={props} type="extension"></WebComponentWrapper>