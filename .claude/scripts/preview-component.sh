#!/bin/bash
# Quick component preview - generates HTML and opens in browser
# Usage: ./preview-component.sh [filename.html]

FILE="${1:-/tmp/component-preview.html}"

# If no file provided, create from clipboard or stdin
if [ -z "$1" ]; then
  echo "Creating preview at $FILE"
  cat > "$FILE" << 'TEMPLATE'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Component Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          // Add your design tokens here
        }
      }
    }
  </script>
  <style type="text/tailwindcss">
    @layer utilities {
      .debug * { outline: 1px solid red; }
    }
  </style>
</head>
<body class="min-h-screen bg-gray-50 p-8">
  <div class="max-w-4xl mx-auto space-y-8">

    <!-- PASTE YOUR COMPONENT HTML HERE -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-xl font-semibold">Preview Component</h2>
      <p class="text-gray-600 mt-2">Replace this with your component code</p>
    </div>

  </div>

  <!-- Debug toggle -->
  <button
    onclick="document.body.classList.toggle('debug')"
    class="fixed bottom-4 right-4 bg-gray-800 text-white px-3 py-1 rounded text-sm"
  >
    Toggle Outlines
  </button>
</body>
</html>
TEMPLATE
fi

# Open in browser (cross-platform)
if command -v xdg-open &> /dev/null; then
  xdg-open "$FILE"
elif command -v open &> /dev/null; then
  open "$FILE"
elif command -v start &> /dev/null; then
  start "$FILE"
else
  echo "Preview ready at: $FILE"
fi
