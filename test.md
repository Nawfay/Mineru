

Let me look at the current DOM tree implementation and the prompt that uses it, plus the debug output you have open to understand what's being sent now.

Now let me look at how browser-use does it and check the decision-maker where the prompt is built:

Now I have a clear picture. Let me look at how browser-use approaches this to understand the key differences:

Let me look at the actual browser-use source code for their DOM serialization:

Now let me look at the actual serializer:

Now I have a thorough understanding of both approaches. Let me look at the current runner to understand the full flow:

Okay, I now have a complete picture. Here's what I see and what we can do. Let me break down the key differences between your current approach and browser-use's approach, then implement the improvements.

Your current tree is already using the accessibility tree (good), but there are several ways to make it much smarter:

1. Your tree outputs every node including tons of non-interactive structural noise (paragraphs, headings with just text). Browser-use strips this down to only show interactive elements + their text context, using a compact HTML-like format.

2. You're not showing useful attributes like `placeholder`, `type`, `aria-expanded`, `checked` inline on the element tag. Browser-use includes these as attributes.

3. You're wasting tokens on deep nesting of purely structural nodes. Browser-use collapses non-interactive wrappers.

4. No visibility filtering. You're including off-screen/footer elements that bloat the tree.

5. No scroll position info. Browser-use tells the LLM "2.3 pages below" so it knows when to scroll.

Let me rewrite the DOM tree serializer to be much more compact and token-efficient:

Now let me implement the smarter DOM tree. The key improvements inspired by browser-use:

1. Compact HTML-like format (`<tag attr=val />`) instead of verbose role-based tree
2. Only show interactive elements with `[id]` markers + text context around them
3. Collapse non-interactive wrapper nodes (divs, spans, etc.)
4. Include useful attributes inline (type, placeholder, value, checked, expanded, etc.)
5. Add viewport awareness (skip off-screen footer junk, add scroll hints)
6. Much more token-efficient

Now let me add back the tagging functions that the rest of the code depends on:

Now let me check for any issues:

Clean. Now let me update the decision-maker prompt to match the new compact format:

Let me also verify the whole project compiles:

Everything compiles clean. Let me show you what the difference looks like with that same Clutch.ca page. Here's a before/after comparison:

**Before** (your old format — ~4500 tokens for that page):
```
RootWebArea "Used 2021 BMW 3 Series for Sale | Clutch" (focused)
  banner
    paragraph
      text "New deals every week.  "
    [0] link "Shop deals."
      text "Shop deals."
    navigation
      [1] link "landing page"
        image "Clutch logo"
      [2] link "Shop Cars"
        paragraph
          text "Shop Cars"
    ...
    [11] checkbox (checked=true)
    paragraph
      text "BMW"
    [12] checkbox (checked=false)
    paragraph
      text "2 Series"
```

**After** (new format — roughly 40-50% fewer tokens):
```
[scroll position: 0% | 2.3 pages below]
banner
	New deals every week.
	[0]<a>Shop deals.</a>
	navigation
		[1]<a>landing page</a>
		[2]<a>Shop Cars</a>
		[3]<a>Sell or Trade</a>
		[4]<button expanded=false>Financing</button>
		[5]<button expanded=false>More</button>
main
	DEALS
	[6]<button expanded=false>DEALS</button>
	MAKE & MODEL
	[8]<button expanded=true>MAKE & MODEL</button>
	[9]<input type="checkbox" checked=false>Acura</input>
	[11]<input type="checkbox" checked=true>BMW</input>
	[13]<input type="checkbox" checked=true>3 Series</input>
	YEAR
	[78]<button expanded=true>YEAR</button>
	[79]<input value="2021" />
	[80]<input value="2021" />
	[81]<input type="range" value="50" />
	MILEAGE (km)
	[83]<button expanded=false>MILEAGE (km)</button>
	...
	2 results
	[100]<a>2021 BMW 3 Series 330i xDrive Sedan 42,043 km $31,190</a>
	[104]<a>2021 BMW 3 Series 330i xDrive Sedan 42,773 km $34,790</a>
```

Here's what changed and why it's smarter:

- Scroll position at the top so the LLM knows if it needs to scroll
- HTML-like tags (`<button>`, `<input>`, `<a>`) instead of role names — more intuitive for the LLM since it's trained on HTML
- Attributes inline on the tag (`checked=true`, `expanded=false`, `value="2021"`) instead of separate property lines
- Non-interactive wrappers (paragraphs, generic divs) are collapsed — their text flows directly
- Checkbox labels appear as the element's text content instead of being a separate paragraph node
- Structural landmarks (`banner`, `navigation`, `main`) kept as section headers for context
- Tab-indented instead of space-indented (fewer tokens)
- The prompt itself is also ~40% shorter — less instruction repetition, more concise rules

The prompt went from verbose instructions to a compact reference card. The LLM gets the same info with way less noise.