(function () {
  // console.log("AutoGroupDuration plugin loaded!");

  // Keep track of already processed groups to prevent duplicates
  const processedGroups = new Set();
  
  // Create a unique marker attribute to identify elements created by this plugin
  const PLUGIN_MARKER = "data-auto-group-duration";

  // Function to handle a single group page - to avoid duplicate processing
  function processGroupPage(groupId, detailsContainer) {
    // Exit early if this group has already been processed
    if (processedGroups.has(groupId)) {
      // console.log("AutoGroupDuration: Group ID", groupId, "already processed, skipping");
      return;
    }
    
    // Mark this group as being processed
    processedGroups.add(groupId);
    
    // Check if there's already an element we created (with our marker)
    const existingPluginElement = detailsContainer.querySelector(`[${PLUGIN_MARKER}]`);
    if (existingPluginElement) {
      // console.log("AutoGroupDuration: Found existing element created by this plugin, skipping");
      return;
    }
    
    // Check if duration element already exists and has a value
    const existingDurationElement = detailsContainer.querySelector('.detail-item.duration');
    const durationValueElement = existingDurationElement?.querySelector('.detail-item-value.duration');
    
    // If duration is already set (not empty), don't overwrite it
    if (durationValueElement && durationValueElement.textContent.trim() !== "") {
      const durationText = durationValueElement.textContent.trim();
      // Check if it's not the default "0:00" or empty
      if (durationText !== "0:00" && durationText !== "") {
        // console.log("AutoGroupDuration: Duration already set to", durationText, "- exiting");
        return; // Duration is already set, no need to calculate
      }
    }

    // GraphQL query to get scenes in the group
    const query = `
      query FindGroup($id: ID!) {
        findGroup(id: $id) {
          id
          name
          scenes {
            id
            files {
              duration
            }
          }
        }
      }
    `;

    const variables = { id: groupId };

    // console.log("AutoGroupDuration: Fetching group data...");
    
    // Call the GraphQL API
    csLib.callGQL({ query, variables })
      .then(result => {
        // console.log("AutoGroupDuration: GraphQL response:", result);
        
        if (!result || !result.findGroup) {
          // console.error("AutoGroupDuration: Failed to get group data");
          return;
        }
        
        // Check if group has scenes
        if (!result.findGroup.scenes || result.findGroup.scenes.length === 0) {
          // console.log("AutoGroupDuration: Group has no scenes, not displaying duration");
          return;
        }

        // Calculate total duration from all scenes in the group
        let totalDuration = 0;
        result.findGroup.scenes.forEach(scene => {
          // For each scene, get the duration from the first file (if it exists)
          if (scene.files && scene.files.length > 0 && scene.files[0].duration) {
            totalDuration += scene.files[0].duration;
          }
        });

        // console.log("AutoGroupDuration: Total duration calculated:", totalDuration);
        
        // If total duration is 0, don't display anything
        if (totalDuration <= 0) {
          // console.log("AutoGroupDuration: Total duration is 0, not displaying");
          return;
        }

        // Format the duration as HH:MM:SS
        const formattedDuration = formatDuration(totalDuration);
        // console.log("AutoGroupDuration: Formatted duration:", formattedDuration);

        // If duration element already exists, update its value
        if (existingDurationElement && durationValueElement) {
          // console.log("AutoGroupDuration: Updating existing duration element");
          durationValueElement.textContent = formattedDuration;
        } else {
          // console.log("AutoGroupDuration: Creating new duration element");
          // Otherwise, create a new duration element
          const durationElement = document.createElement('div');
          durationElement.className = 'detail-item duration';
          durationElement.setAttribute(PLUGIN_MARKER, 'true'); // Mark as created by this plugin
          
          durationElement.innerHTML = `
            <span class="detail-item-title duration">Duration</span>
            <span class="detail-item-value duration">${formattedDuration}</span>
          `;
          
          // Always insert at the beginning of the details container
          const firstDetailItem = detailsContainer.querySelector('.detail-item');
          if (firstDetailItem) {
            // console.log("AutoGroupDuration: Inserting at the beginning before first detail item");
            detailsContainer.insertBefore(durationElement, firstDetailItem);
          } else {
            // If no detail items, append to the details container
            // console.log("AutoGroupDuration: Appending to details container");
            detailsContainer.appendChild(durationElement);
          }
        }
      })
      .catch(error => {
        // console.error("AutoGroupDuration: Error fetching group data:", error);
      });
  }

  // Wait for the DOM to load and get elements only on the group detail page
  csLib.PathElementListener("/groups/", "div.detail-header", function (detailHeader) {
    // console.log("AutoGroupDuration: Group detail page detected");
    
    // Get the group ID from the URL with a regex that works for both '/groups/112' and '/groups/112/scenes'
    const groupIdRegex = /\/groups\/(\d+)(?:\/|$)/;
    const match = window.location.pathname.match(groupIdRegex);
    
    if (!match || !match[1]) {
      // console.log("AutoGroupDuration: Cannot extract group ID from URL, exiting");
      return;
    }
    
    const groupId = match[1];
    // console.log("AutoGroupDuration: Group ID:", groupId);

    // Instead of waiting with setInterval, use MutationObserver to detect when details container is added
    // This is more reliable than polling
    const observer = new MutationObserver((mutations, obs) => {
      const detailsContainer = document.querySelector('div.detail-group');
      if (detailsContainer) {
        obs.disconnect(); // Stop observing once we find the container
        // console.log("AutoGroupDuration: Found details container");
        processGroupPage(groupId, detailsContainer);
      }
    });
    
    // Start observing the document with the configured parameters
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Set a timeout to stop the observer after 10 seconds to prevent memory leaks
    setTimeout(() => {
      observer.disconnect();
      // console.log("AutoGroupDuration: Timeout reached, stopping observation");
    }, 10000);
  });

  // Helper function to format seconds into HH:MM:SS
  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }
})(); 