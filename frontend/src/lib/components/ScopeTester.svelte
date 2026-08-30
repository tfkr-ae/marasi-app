<script>
    import { onMount } from "svelte";
    import { modeCurrent } from "@skeletonlabs/skeleton";
    import { testerInput } from "../../stores";
    import { TestScopeMatch } from "../wailsjs/go/main/App";

    // Result data
    let lastResult = null;
    let loading = false;
    let error = null;
    let resultKey = 0; // Add a key to force re-rendering
    
    async function testMatch() {
      if (!$testerInput.trim()) {
        error = 'Please enter a URL to test';
        return;
      }
      
      error = null;
      loading = true;
      
      // Clear previous result to ensure UI updates properly
      lastResult = null;
      
      try {
        // Call the Go backend function
        const result = await TestScopeMatch($testerInput);
        
        // Increment the key to force re-rendering
        resultKey++;
        
        if (result.error) {
          error = result.error;
        } else {
          lastResult = result;
        }
      } catch (err) {
        error = `Error testing match: ${err.message || err}`;
        console.error(err);
      } finally {
        loading = false;
      }
    }
    
    function getResultClass() {
      if (!lastResult || lastResult.error) return '';
      if (lastResult.inScope) {
        return $modeCurrent
          ? 'bg-success-100 text-success-800 border border-success-300'
          : 'bg-success-700 text-success-100 border border-success-600';
      }
      return $modeCurrent
        ? 'bg-error-100 text-error-800 border border-error-300'
        : 'bg-error-700 text-error-100 border border-error-600';
    }
    
    // Function to clean up regex patterns for display
    function formatRegexPattern(pattern) {
      if (!pattern) return '';
      // Replace escaped dots and other common escape sequences
      return pattern.replace(/\\\./g, '.')
                   .replace(/\\\//g, '/')
                   .replace(/\\\\/g, '\\')
                   .replace(/\\\(/g, '(')
                   .replace(/\\\)/g, ')')
                   .replace(/\\\[/g, '[')
                   .replace(/\\\]/g, ']')
                   .replace(/\\\?/g, '?')
                   .replace(/\\\+/g, '+')
                   .replace(/\\\*/g, '*');
    }
    
    onMount(async () => {
        if ($testerInput != "") {
            await testMatch();
        }
    })
  </script>
  
  <div class="w-full">
    <!-- Removed card class and p-4 padding -->
    <div class="w-full">
      <div class="mb-4">
        <label for="urlInput" class="block mb-1">URL / Host to test:</label>
        <input
          id="urlInput"
          type="text"
          bind:value={$testerInput}
          class="input w-full"
          placeholder="Enter a URL or Host (e.g., example.com or https://example.com/path)"
        />
        <div class="text-sm mt-1">
          Include protocol (http://) if your rules specifically match against it. If omitted, https:// will be used.
        </div>
      </div>
      
      <div class="text-center mb-4">
        <button 
          on:click={testMatch} 
          class="btn {$modeCurrent ? 'variant-ghost-primary' : 'variant-filled-primary'} border-0 ring-0"
          disabled={loading}
        >
          {loading ? 'Testing...' : 'Test Rules'}
        </button>
      </div>
      
      {#if error}
        <div class="mt-4 p-2 bg-error-100 text-error-800 border border-error-300 dark:bg-error-700 dark:text-error-100 dark:border-error-600 rounded">
          {error}
        </div>
      {/if}
      
      {#if lastResult && !error}
        <!-- Add key attribute to force re-rendering -->
        <div key={resultKey} class="mt-4 p-3 {getResultClass()}">
          <div class="mt-2">
            <p><b>Tested URL:</b> {lastResult.testedUrl}</p>
            
            {#if lastResult.defaultAllowUsed}
              <!-- Default policy case -->
              <p>
                <b>In Scope:</b> {lastResult.inScope ? 'Yes (by default allow policy)' : 'No (by default allow policy)'}
              </p>
              <p><b>No specific rule matched.</b> Using default behavior.</p>
            {:else}
              <!-- Specific rule match case -->
              <p><b>In Scope:</b> {lastResult.inScope ? 'Yes' : 'No'}</p>
              
              {#if lastResult.matchedRule}
                <p><b>Matched Rule:</b> {formatRegexPattern(lastResult.matchedRule)}</p>
                <p><b>Matched as:</b> {lastResult.matchedAs}</p>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
