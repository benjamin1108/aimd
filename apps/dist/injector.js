"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/@mozilla/readability/Readability.js
  var require_Readability = __commonJS({
    "node_modules/@mozilla/readability/Readability.js"(exports, module) {
      function Readability2(doc, options) {
        if (options && options.documentElement) {
          doc = options;
          options = arguments[2];
        } else if (!doc || !doc.documentElement) {
          throw new Error(
            "First argument to Readability constructor should be a document object."
          );
        }
        options = options || {};
        this._doc = doc;
        this._docJSDOMParser = this._doc.firstChild.__JSDOMParser__;
        this._articleTitle = null;
        this._articleByline = null;
        this._articleDir = null;
        this._articleSiteName = null;
        this._attempts = [];
        this._metadata = {};
        this._debug = !!options.debug;
        this._maxElemsToParse = options.maxElemsToParse || this.DEFAULT_MAX_ELEMS_TO_PARSE;
        this._nbTopCandidates = options.nbTopCandidates || this.DEFAULT_N_TOP_CANDIDATES;
        this._charThreshold = options.charThreshold || this.DEFAULT_CHAR_THRESHOLD;
        this._classesToPreserve = this.CLASSES_TO_PRESERVE.concat(
          options.classesToPreserve || []
        );
        this._keepClasses = !!options.keepClasses;
        this._serializer = options.serializer || function(el) {
          return el.innerHTML;
        };
        this._disableJSONLD = !!options.disableJSONLD;
        this._allowedVideoRegex = options.allowedVideoRegex || this.REGEXPS.videos;
        this._linkDensityModifier = options.linkDensityModifier || 0;
        this._flags = this.FLAG_STRIP_UNLIKELYS | this.FLAG_WEIGHT_CLASSES | this.FLAG_CLEAN_CONDITIONALLY;
        if (this._debug) {
          let logNode = function(node) {
            if (node.nodeType == node.TEXT_NODE) {
              return `${node.nodeName} ("${node.textContent}")`;
            }
            let attrPairs = Array.from(node.attributes || [], function(attr) {
              return `${attr.name}="${attr.value}"`;
            }).join(" ");
            return `<${node.localName} ${attrPairs}>`;
          };
          this.log = function() {
            if (typeof console !== "undefined") {
              let args = Array.from(arguments, (arg) => {
                if (arg && arg.nodeType == this.ELEMENT_NODE) {
                  return logNode(arg);
                }
                return arg;
              });
              args.unshift("Reader: (Readability)");
              console.log(...args);
            } else if (typeof dump !== "undefined") {
              var msg = Array.prototype.map.call(arguments, function(x) {
                return x && x.nodeName ? logNode(x) : x;
              }).join(" ");
              dump("Reader: (Readability) " + msg + "\n");
            }
          };
        } else {
          this.log = function() {
          };
        }
      }
      Readability2.prototype = {
        FLAG_STRIP_UNLIKELYS: 1,
        FLAG_WEIGHT_CLASSES: 2,
        FLAG_CLEAN_CONDITIONALLY: 4,
        // https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType
        ELEMENT_NODE: 1,
        TEXT_NODE: 3,
        // Max number of nodes supported by this parser. Default: 0 (no limit)
        DEFAULT_MAX_ELEMS_TO_PARSE: 0,
        // The number of top candidates to consider when analysing how
        // tight the competition is among candidates.
        DEFAULT_N_TOP_CANDIDATES: 5,
        // Element tags to score by default.
        DEFAULT_TAGS_TO_SCORE: "section,h2,h3,h4,h5,h6,p,td,pre".toUpperCase().split(","),
        // The default number of chars an article must have in order to return a result
        DEFAULT_CHAR_THRESHOLD: 500,
        // All of the regular expressions in use within readability.
        // Defined up here so we don't instantiate them repeatedly in loops.
        REGEXPS: {
          // NOTE: These two regular expressions are duplicated in
          // Readability-readerable.js. Please keep both copies in sync.
          unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
          okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,
          positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
          negative: /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i,
          extraneous: /print|archive|comment|discuss|e[\-]?mail|share|reply|all|login|sign|single|utility/i,
          byline: /byline|author|dateline|writtenby|p-author/i,
          replaceFonts: /<(\/?)font[^>]*>/gi,
          normalize: /\s{2,}/g,
          videos: /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i,
          shareElements: /(\b|_)(share|sharedaddy)(\b|_)/i,
          nextLink: /(next|weiter|continue|>([^\|]|$)|»([^\|]|$))/i,
          prevLink: /(prev|earl|old|new|<|«)/i,
          tokenize: /\W+/g,
          whitespace: /^\s*$/,
          hasContent: /\S$/,
          hashUrl: /^#.+/,
          srcsetUrl: /(\S+)(\s+[\d.]+[xw])?(\s*(?:,|$))/g,
          b64DataUrl: /^data:\s*([^\s;,]+)\s*;\s*base64\s*,/i,
          // Commas as used in Latin, Sindhi, Chinese and various other scripts.
          // see: https://en.wikipedia.org/wiki/Comma#Comma_variants
          commas: /\u002C|\u060C|\uFE50|\uFE10|\uFE11|\u2E41|\u2E34|\u2E32|\uFF0C/g,
          // See: https://schema.org/Article
          jsonLdArticleTypes: /^Article|AdvertiserContentArticle|NewsArticle|AnalysisNewsArticle|AskPublicNewsArticle|BackgroundNewsArticle|OpinionNewsArticle|ReportageNewsArticle|ReviewNewsArticle|Report|SatiricalArticle|ScholarlyArticle|MedicalScholarlyArticle|SocialMediaPosting|BlogPosting|LiveBlogPosting|DiscussionForumPosting|TechArticle|APIReference$/,
          // used to see if a node's content matches words commonly used for ad blocks or loading indicators
          adWords: /^(ad(vertising|vertisement)?|pub(licité)?|werb(ung)?|广告|Реклама|Anuncio)$/iu,
          loadingWords: /^((loading|正在加载|Загрузка|chargement|cargando)(…|\.\.\.)?)$/iu
        },
        UNLIKELY_ROLES: [
          "menu",
          "menubar",
          "complementary",
          "navigation",
          "alert",
          "alertdialog",
          "dialog"
        ],
        DIV_TO_P_ELEMS: /* @__PURE__ */ new Set([
          "BLOCKQUOTE",
          "DL",
          "DIV",
          "IMG",
          "OL",
          "P",
          "PRE",
          "TABLE",
          "UL"
        ]),
        ALTER_TO_DIV_EXCEPTIONS: ["DIV", "ARTICLE", "SECTION", "P", "OL", "UL"],
        PRESENTATIONAL_ATTRIBUTES: [
          "align",
          "background",
          "bgcolor",
          "border",
          "cellpadding",
          "cellspacing",
          "frame",
          "hspace",
          "rules",
          "style",
          "valign",
          "vspace"
        ],
        DEPRECATED_SIZE_ATTRIBUTE_ELEMS: ["TABLE", "TH", "TD", "HR", "PRE"],
        // The commented out elements qualify as phrasing content but tend to be
        // removed by readability when put into paragraphs, so we ignore them here.
        PHRASING_ELEMS: [
          // "CANVAS", "IFRAME", "SVG", "VIDEO",
          "ABBR",
          "AUDIO",
          "B",
          "BDO",
          "BR",
          "BUTTON",
          "CITE",
          "CODE",
          "DATA",
          "DATALIST",
          "DFN",
          "EM",
          "EMBED",
          "I",
          "IMG",
          "INPUT",
          "KBD",
          "LABEL",
          "MARK",
          "MATH",
          "METER",
          "NOSCRIPT",
          "OBJECT",
          "OUTPUT",
          "PROGRESS",
          "Q",
          "RUBY",
          "SAMP",
          "SCRIPT",
          "SELECT",
          "SMALL",
          "SPAN",
          "STRONG",
          "SUB",
          "SUP",
          "TEXTAREA",
          "TIME",
          "VAR",
          "WBR"
        ],
        // These are the classes that readability sets itself.
        CLASSES_TO_PRESERVE: ["page"],
        // These are the list of HTML entities that need to be escaped.
        HTML_ESCAPE_MAP: {
          lt: "<",
          gt: ">",
          amp: "&",
          quot: '"',
          apos: "'"
        },
        /**
         * Run any post-process modifications to article content as necessary.
         *
         * @param Element
         * @return void
         **/
        _postProcessContent(articleContent) {
          this._fixRelativeUris(articleContent);
          this._simplifyNestedElements(articleContent);
          if (!this._keepClasses) {
            this._cleanClasses(articleContent);
          }
        },
        /**
         * Iterates over a NodeList, calls `filterFn` for each node and removes node
         * if function returned `true`.
         *
         * If function is not passed, removes all the nodes in node list.
         *
         * @param NodeList nodeList The nodes to operate on
         * @param Function filterFn the function to use as a filter
         * @return void
         */
        _removeNodes(nodeList, filterFn) {
          if (this._docJSDOMParser && nodeList._isLiveNodeList) {
            throw new Error("Do not pass live node lists to _removeNodes");
          }
          for (var i = nodeList.length - 1; i >= 0; i--) {
            var node = nodeList[i];
            var parentNode = node.parentNode;
            if (parentNode) {
              if (!filterFn || filterFn.call(this, node, i, nodeList)) {
                parentNode.removeChild(node);
              }
            }
          }
        },
        /**
         * Iterates over a NodeList, and calls _setNodeTag for each node.
         *
         * @param NodeList nodeList The nodes to operate on
         * @param String newTagName the new tag name to use
         * @return void
         */
        _replaceNodeTags(nodeList, newTagName) {
          if (this._docJSDOMParser && nodeList._isLiveNodeList) {
            throw new Error("Do not pass live node lists to _replaceNodeTags");
          }
          for (const node of nodeList) {
            this._setNodeTag(node, newTagName);
          }
        },
        /**
         * Iterate over a NodeList, which doesn't natively fully implement the Array
         * interface.
         *
         * For convenience, the current object context is applied to the provided
         * iterate function.
         *
         * @param  NodeList nodeList The NodeList.
         * @param  Function fn       The iterate function.
         * @return void
         */
        _forEachNode(nodeList, fn) {
          Array.prototype.forEach.call(nodeList, fn, this);
        },
        /**
         * Iterate over a NodeList, and return the first node that passes
         * the supplied test function
         *
         * For convenience, the current object context is applied to the provided
         * test function.
         *
         * @param  NodeList nodeList The NodeList.
         * @param  Function fn       The test function.
         * @return void
         */
        _findNode(nodeList, fn) {
          return Array.prototype.find.call(nodeList, fn, this);
        },
        /**
         * Iterate over a NodeList, return true if any of the provided iterate
         * function calls returns true, false otherwise.
         *
         * For convenience, the current object context is applied to the
         * provided iterate function.
         *
         * @param  NodeList nodeList The NodeList.
         * @param  Function fn       The iterate function.
         * @return Boolean
         */
        _someNode(nodeList, fn) {
          return Array.prototype.some.call(nodeList, fn, this);
        },
        /**
         * Iterate over a NodeList, return true if all of the provided iterate
         * function calls return true, false otherwise.
         *
         * For convenience, the current object context is applied to the
         * provided iterate function.
         *
         * @param  NodeList nodeList The NodeList.
         * @param  Function fn       The iterate function.
         * @return Boolean
         */
        _everyNode(nodeList, fn) {
          return Array.prototype.every.call(nodeList, fn, this);
        },
        _getAllNodesWithTag(node, tagNames) {
          if (node.querySelectorAll) {
            return node.querySelectorAll(tagNames.join(","));
          }
          return [].concat.apply(
            [],
            tagNames.map(function(tag) {
              var collection = node.getElementsByTagName(tag);
              return Array.isArray(collection) ? collection : Array.from(collection);
            })
          );
        },
        /**
         * Removes the class="" attribute from every element in the given
         * subtree, except those that match CLASSES_TO_PRESERVE and
         * the classesToPreserve array from the options object.
         *
         * @param Element
         * @return void
         */
        _cleanClasses(node) {
          var classesToPreserve = this._classesToPreserve;
          var className = (node.getAttribute("class") || "").split(/\s+/).filter((cls) => classesToPreserve.includes(cls)).join(" ");
          if (className) {
            node.setAttribute("class", className);
          } else {
            node.removeAttribute("class");
          }
          for (node = node.firstElementChild; node; node = node.nextElementSibling) {
            this._cleanClasses(node);
          }
        },
        /**
         * Tests whether a string is a URL or not.
         *
         * @param {string} str The string to test
         * @return {boolean} true if str is a URL, false if not
         */
        _isUrl(str) {
          try {
            new URL(str);
            return true;
          } catch {
            return false;
          }
        },
        /**
         * Converts each <a> and <img> uri in the given element to an absolute URI,
         * ignoring #ref URIs.
         *
         * @param Element
         * @return void
         */
        _fixRelativeUris(articleContent) {
          var baseURI = this._doc.baseURI;
          var documentURI = this._doc.documentURI;
          function toAbsoluteURI(uri) {
            if (baseURI == documentURI && uri.charAt(0) == "#") {
              return uri;
            }
            try {
              return new URL(uri, baseURI).href;
            } catch (ex) {
            }
            return uri;
          }
          var links = this._getAllNodesWithTag(articleContent, ["a"]);
          this._forEachNode(links, function(link) {
            var href = link.getAttribute("href");
            if (href) {
              if (href.indexOf("javascript:") === 0) {
                if (link.childNodes.length === 1 && link.childNodes[0].nodeType === this.TEXT_NODE) {
                  var text = this._doc.createTextNode(link.textContent);
                  link.parentNode.replaceChild(text, link);
                } else {
                  var container = this._doc.createElement("span");
                  while (link.firstChild) {
                    container.appendChild(link.firstChild);
                  }
                  link.parentNode.replaceChild(container, link);
                }
              } else {
                link.setAttribute("href", toAbsoluteURI(href));
              }
            }
          });
          var medias = this._getAllNodesWithTag(articleContent, [
            "img",
            "picture",
            "figure",
            "video",
            "audio",
            "source"
          ]);
          this._forEachNode(medias, function(media) {
            var src = media.getAttribute("src");
            var poster = media.getAttribute("poster");
            var srcset = media.getAttribute("srcset");
            if (src) {
              media.setAttribute("src", toAbsoluteURI(src));
            }
            if (poster) {
              media.setAttribute("poster", toAbsoluteURI(poster));
            }
            if (srcset) {
              var newSrcset = srcset.replace(
                this.REGEXPS.srcsetUrl,
                function(_, p1, p2, p3) {
                  return toAbsoluteURI(p1) + (p2 || "") + p3;
                }
              );
              media.setAttribute("srcset", newSrcset);
            }
          });
        },
        _simplifyNestedElements(articleContent) {
          var node = articleContent;
          while (node) {
            if (node.parentNode && ["DIV", "SECTION"].includes(node.tagName) && !(node.id && node.id.startsWith("readability"))) {
              if (this._isElementWithoutContent(node)) {
                node = this._removeAndGetNext(node);
                continue;
              } else if (this._hasSingleTagInsideElement(node, "DIV") || this._hasSingleTagInsideElement(node, "SECTION")) {
                var child = node.children[0];
                for (var i = 0; i < node.attributes.length; i++) {
                  child.setAttributeNode(node.attributes[i].cloneNode());
                }
                node.parentNode.replaceChild(child, node);
                node = child;
                continue;
              }
            }
            node = this._getNextNode(node);
          }
        },
        /**
         * Get the article title as an H1.
         *
         * @return string
         **/
        _getArticleTitle() {
          var doc = this._doc;
          var curTitle = "";
          var origTitle = "";
          try {
            curTitle = origTitle = doc.title.trim();
            if (typeof curTitle !== "string") {
              curTitle = origTitle = this._getInnerText(
                doc.getElementsByTagName("title")[0]
              );
            }
          } catch (e) {
          }
          var titleHadHierarchicalSeparators = false;
          function wordCount(str) {
            return str.split(/\s+/).length;
          }
          if (/ [\|\-\\\/>»] /.test(curTitle)) {
            titleHadHierarchicalSeparators = / [\\\/>»] /.test(curTitle);
            let allSeparators = Array.from(origTitle.matchAll(/ [\|\-\\\/>»] /gi));
            curTitle = origTitle.substring(0, allSeparators.pop().index);
            if (wordCount(curTitle) < 3) {
              curTitle = origTitle.replace(/^[^\|\-\\\/>»]*[\|\-\\\/>»]/gi, "");
            }
          } else if (curTitle.includes(": ")) {
            var headings = this._getAllNodesWithTag(doc, ["h1", "h2"]);
            var trimmedTitle = curTitle.trim();
            var match = this._someNode(headings, function(heading) {
              return heading.textContent.trim() === trimmedTitle;
            });
            if (!match) {
              curTitle = origTitle.substring(origTitle.lastIndexOf(":") + 1);
              if (wordCount(curTitle) < 3) {
                curTitle = origTitle.substring(origTitle.indexOf(":") + 1);
              } else if (wordCount(origTitle.substr(0, origTitle.indexOf(":"))) > 5) {
                curTitle = origTitle;
              }
            }
          } else if (curTitle.length > 150 || curTitle.length < 15) {
            var hOnes = doc.getElementsByTagName("h1");
            if (hOnes.length === 1) {
              curTitle = this._getInnerText(hOnes[0]);
            }
          }
          curTitle = curTitle.trim().replace(this.REGEXPS.normalize, " ");
          var curTitleWordCount = wordCount(curTitle);
          if (curTitleWordCount <= 4 && (!titleHadHierarchicalSeparators || curTitleWordCount != wordCount(origTitle.replace(/[\|\-\\\/>»]+/g, "")) - 1)) {
            curTitle = origTitle;
          }
          return curTitle;
        },
        /**
         * Prepare the HTML document for readability to scrape it.
         * This includes things like stripping javascript, CSS, and handling terrible markup.
         *
         * @return void
         **/
        _prepDocument() {
          var doc = this._doc;
          this._removeNodes(this._getAllNodesWithTag(doc, ["style"]));
          if (doc.body) {
            this._replaceBrs(doc.body);
          }
          this._replaceNodeTags(this._getAllNodesWithTag(doc, ["font"]), "SPAN");
        },
        /**
         * Finds the next node, starting from the given node, and ignoring
         * whitespace in between. If the given node is an element, the same node is
         * returned.
         */
        _nextNode(node) {
          var next = node;
          while (next && next.nodeType != this.ELEMENT_NODE && this.REGEXPS.whitespace.test(next.textContent)) {
            next = next.nextSibling;
          }
          return next;
        },
        /**
         * Replaces 2 or more successive <br> elements with a single <p>.
         * Whitespace between <br> elements are ignored. For example:
         *   <div>foo<br>bar<br> <br><br>abc</div>
         * will become:
         *   <div>foo<br>bar<p>abc</p></div>
         */
        _replaceBrs(elem) {
          this._forEachNode(this._getAllNodesWithTag(elem, ["br"]), function(br) {
            var next = br.nextSibling;
            var replaced = false;
            while ((next = this._nextNode(next)) && next.tagName == "BR") {
              replaced = true;
              var brSibling = next.nextSibling;
              next.remove();
              next = brSibling;
            }
            if (replaced) {
              var p = this._doc.createElement("p");
              br.parentNode.replaceChild(p, br);
              next = p.nextSibling;
              while (next) {
                if (next.tagName == "BR") {
                  var nextElem = this._nextNode(next.nextSibling);
                  if (nextElem && nextElem.tagName == "BR") {
                    break;
                  }
                }
                if (!this._isPhrasingContent(next)) {
                  break;
                }
                var sibling = next.nextSibling;
                p.appendChild(next);
                next = sibling;
              }
              while (p.lastChild && this._isWhitespace(p.lastChild)) {
                p.lastChild.remove();
              }
              if (p.parentNode.tagName === "P") {
                this._setNodeTag(p.parentNode, "DIV");
              }
            }
          });
        },
        _setNodeTag(node, tag) {
          this.log("_setNodeTag", node, tag);
          if (this._docJSDOMParser) {
            node.localName = tag.toLowerCase();
            node.tagName = tag.toUpperCase();
            return node;
          }
          var replacement = node.ownerDocument.createElement(tag);
          while (node.firstChild) {
            replacement.appendChild(node.firstChild);
          }
          node.parentNode.replaceChild(replacement, node);
          if (node.readability) {
            replacement.readability = node.readability;
          }
          for (var i = 0; i < node.attributes.length; i++) {
            replacement.setAttributeNode(node.attributes[i].cloneNode());
          }
          return replacement;
        },
        /**
         * Prepare the article node for display. Clean out any inline styles,
         * iframes, forms, strip extraneous <p> tags, etc.
         *
         * @param Element
         * @return void
         **/
        _prepArticle(articleContent) {
          this._cleanStyles(articleContent);
          this._markDataTables(articleContent);
          this._fixLazyImages(articleContent);
          this._cleanConditionally(articleContent, "form");
          this._cleanConditionally(articleContent, "fieldset");
          this._clean(articleContent, "object");
          this._clean(articleContent, "embed");
          this._clean(articleContent, "footer");
          this._clean(articleContent, "link");
          this._clean(articleContent, "aside");
          var shareElementThreshold = this.DEFAULT_CHAR_THRESHOLD;
          this._forEachNode(articleContent.children, function(topCandidate) {
            this._cleanMatchedNodes(topCandidate, function(node, matchString) {
              return this.REGEXPS.shareElements.test(matchString) && node.textContent.length < shareElementThreshold;
            });
          });
          this._clean(articleContent, "iframe");
          this._clean(articleContent, "input");
          this._clean(articleContent, "textarea");
          this._clean(articleContent, "select");
          this._clean(articleContent, "button");
          this._cleanHeaders(articleContent);
          this._cleanConditionally(articleContent, "table");
          this._cleanConditionally(articleContent, "ul");
          this._cleanConditionally(articleContent, "div");
          this._replaceNodeTags(
            this._getAllNodesWithTag(articleContent, ["h1"]),
            "h2"
          );
          this._removeNodes(
            this._getAllNodesWithTag(articleContent, ["p"]),
            function(paragraph) {
              var contentElementCount = this._getAllNodesWithTag(paragraph, [
                "img",
                "embed",
                "object",
                "iframe"
              ]).length;
              return contentElementCount === 0 && !this._getInnerText(paragraph, false);
            }
          );
          this._forEachNode(
            this._getAllNodesWithTag(articleContent, ["br"]),
            function(br) {
              var next = this._nextNode(br.nextSibling);
              if (next && next.tagName == "P") {
                br.remove();
              }
            }
          );
          this._forEachNode(
            this._getAllNodesWithTag(articleContent, ["table"]),
            function(table) {
              var tbody = this._hasSingleTagInsideElement(table, "TBODY") ? table.firstElementChild : table;
              if (this._hasSingleTagInsideElement(tbody, "TR")) {
                var row = tbody.firstElementChild;
                if (this._hasSingleTagInsideElement(row, "TD")) {
                  var cell = row.firstElementChild;
                  cell = this._setNodeTag(
                    cell,
                    this._everyNode(cell.childNodes, this._isPhrasingContent) ? "P" : "DIV"
                  );
                  table.parentNode.replaceChild(cell, table);
                }
              }
            }
          );
        },
        /**
         * Initialize a node with the readability object. Also checks the
         * className/id for special names to add to its score.
         *
         * @param Element
         * @return void
         **/
        _initializeNode(node) {
          node.readability = { contentScore: 0 };
          switch (node.tagName) {
            case "DIV":
              node.readability.contentScore += 5;
              break;
            case "PRE":
            case "TD":
            case "BLOCKQUOTE":
              node.readability.contentScore += 3;
              break;
            case "ADDRESS":
            case "OL":
            case "UL":
            case "DL":
            case "DD":
            case "DT":
            case "LI":
            case "FORM":
              node.readability.contentScore -= 3;
              break;
            case "H1":
            case "H2":
            case "H3":
            case "H4":
            case "H5":
            case "H6":
            case "TH":
              node.readability.contentScore -= 5;
              break;
          }
          node.readability.contentScore += this._getClassWeight(node);
        },
        _removeAndGetNext(node) {
          var nextNode = this._getNextNode(node, true);
          node.remove();
          return nextNode;
        },
        /**
         * Traverse the DOM from node to node, starting at the node passed in.
         * Pass true for the second parameter to indicate this node itself
         * (and its kids) are going away, and we want the next node over.
         *
         * Calling this in a loop will traverse the DOM depth-first.
         *
         * @param {Element} node
         * @param {boolean} ignoreSelfAndKids
         * @return {Element}
         */
        _getNextNode(node, ignoreSelfAndKids) {
          if (!ignoreSelfAndKids && node.firstElementChild) {
            return node.firstElementChild;
          }
          if (node.nextElementSibling) {
            return node.nextElementSibling;
          }
          do {
            node = node.parentNode;
          } while (node && !node.nextElementSibling);
          return node && node.nextElementSibling;
        },
        // compares second text to first one
        // 1 = same text, 0 = completely different text
        // works the way that it splits both texts into words and then finds words that are unique in second text
        // the result is given by the lower length of unique parts
        _textSimilarity(textA, textB) {
          var tokensA = textA.toLowerCase().split(this.REGEXPS.tokenize).filter(Boolean);
          var tokensB = textB.toLowerCase().split(this.REGEXPS.tokenize).filter(Boolean);
          if (!tokensA.length || !tokensB.length) {
            return 0;
          }
          var uniqTokensB = tokensB.filter((token) => !tokensA.includes(token));
          var distanceB = uniqTokensB.join(" ").length / tokensB.join(" ").length;
          return 1 - distanceB;
        },
        /**
         * Checks whether an element node contains a valid byline
         *
         * @param node {Element}
         * @param matchString {string}
         * @return boolean
         */
        _isValidByline(node, matchString) {
          var rel = node.getAttribute("rel");
          var itemprop = node.getAttribute("itemprop");
          var bylineLength = node.textContent.trim().length;
          return (rel === "author" || itemprop && itemprop.includes("author") || this.REGEXPS.byline.test(matchString)) && !!bylineLength && bylineLength < 100;
        },
        _getNodeAncestors(node, maxDepth) {
          maxDepth = maxDepth || 0;
          var i = 0, ancestors = [];
          while (node.parentNode) {
            ancestors.push(node.parentNode);
            if (maxDepth && ++i === maxDepth) {
              break;
            }
            node = node.parentNode;
          }
          return ancestors;
        },
        /***
         * grabArticle - Using a variety of metrics (content score, classname, element types), find the content that is
         *         most likely to be the stuff a user wants to read. Then return it wrapped up in a div.
         *
         * @param page a document to run upon. Needs to be a full document, complete with body.
         * @return Element
         **/
        /* eslint-disable-next-line complexity */
        _grabArticle(page) {
          this.log("**** grabArticle ****");
          var doc = this._doc;
          var isPaging = page !== null;
          page = page ? page : this._doc.body;
          if (!page) {
            this.log("No body found in document. Abort.");
            return null;
          }
          var pageCacheHtml = page.innerHTML;
          while (true) {
            this.log("Starting grabArticle loop");
            var stripUnlikelyCandidates = this._flagIsActive(
              this.FLAG_STRIP_UNLIKELYS
            );
            var elementsToScore = [];
            var node = this._doc.documentElement;
            let shouldRemoveTitleHeader = true;
            while (node) {
              if (node.tagName === "HTML") {
                this._articleLang = node.getAttribute("lang");
              }
              var matchString = node.className + " " + node.id;
              if (!this._isProbablyVisible(node)) {
                this.log("Removing hidden node - " + matchString);
                node = this._removeAndGetNext(node);
                continue;
              }
              if (node.getAttribute("aria-modal") == "true" && node.getAttribute("role") == "dialog") {
                node = this._removeAndGetNext(node);
                continue;
              }
              if (!this._articleByline && !this._metadata.byline && this._isValidByline(node, matchString)) {
                var endOfSearchMarkerNode = this._getNextNode(node, true);
                var next = this._getNextNode(node);
                var itemPropNameNode = null;
                while (next && next != endOfSearchMarkerNode) {
                  var itemprop = next.getAttribute("itemprop");
                  if (itemprop && itemprop.includes("name")) {
                    itemPropNameNode = next;
                    break;
                  } else {
                    next = this._getNextNode(next);
                  }
                }
                this._articleByline = (itemPropNameNode ?? node).textContent.trim();
                node = this._removeAndGetNext(node);
                continue;
              }
              if (shouldRemoveTitleHeader && this._headerDuplicatesTitle(node)) {
                this.log(
                  "Removing header: ",
                  node.textContent.trim(),
                  this._articleTitle.trim()
                );
                shouldRemoveTitleHeader = false;
                node = this._removeAndGetNext(node);
                continue;
              }
              if (stripUnlikelyCandidates) {
                if (this.REGEXPS.unlikelyCandidates.test(matchString) && !this.REGEXPS.okMaybeItsACandidate.test(matchString) && !this._hasAncestorTag(node, "table") && !this._hasAncestorTag(node, "code") && node.tagName !== "BODY" && node.tagName !== "A") {
                  this.log("Removing unlikely candidate - " + matchString);
                  node = this._removeAndGetNext(node);
                  continue;
                }
                if (this.UNLIKELY_ROLES.includes(node.getAttribute("role"))) {
                  this.log(
                    "Removing content with role " + node.getAttribute("role") + " - " + matchString
                  );
                  node = this._removeAndGetNext(node);
                  continue;
                }
              }
              if ((node.tagName === "DIV" || node.tagName === "SECTION" || node.tagName === "HEADER" || node.tagName === "H1" || node.tagName === "H2" || node.tagName === "H3" || node.tagName === "H4" || node.tagName === "H5" || node.tagName === "H6") && this._isElementWithoutContent(node)) {
                node = this._removeAndGetNext(node);
                continue;
              }
              if (this.DEFAULT_TAGS_TO_SCORE.includes(node.tagName)) {
                elementsToScore.push(node);
              }
              if (node.tagName === "DIV") {
                var p = null;
                var childNode = node.firstChild;
                while (childNode) {
                  var nextSibling = childNode.nextSibling;
                  if (this._isPhrasingContent(childNode)) {
                    if (p !== null) {
                      p.appendChild(childNode);
                    } else if (!this._isWhitespace(childNode)) {
                      p = doc.createElement("p");
                      node.replaceChild(p, childNode);
                      p.appendChild(childNode);
                    }
                  } else if (p !== null) {
                    while (p.lastChild && this._isWhitespace(p.lastChild)) {
                      p.lastChild.remove();
                    }
                    p = null;
                  }
                  childNode = nextSibling;
                }
                if (this._hasSingleTagInsideElement(node, "P") && this._getLinkDensity(node) < 0.25) {
                  var newNode = node.children[0];
                  node.parentNode.replaceChild(newNode, node);
                  node = newNode;
                  elementsToScore.push(node);
                } else if (!this._hasChildBlockElement(node)) {
                  node = this._setNodeTag(node, "P");
                  elementsToScore.push(node);
                }
              }
              node = this._getNextNode(node);
            }
            var candidates = [];
            this._forEachNode(elementsToScore, function(elementToScore) {
              if (!elementToScore.parentNode || typeof elementToScore.parentNode.tagName === "undefined") {
                return;
              }
              var innerText = this._getInnerText(elementToScore);
              if (innerText.length < 25) {
                return;
              }
              var ancestors2 = this._getNodeAncestors(elementToScore, 5);
              if (ancestors2.length === 0) {
                return;
              }
              var contentScore = 0;
              contentScore += 1;
              contentScore += innerText.split(this.REGEXPS.commas).length;
              contentScore += Math.min(Math.floor(innerText.length / 100), 3);
              this._forEachNode(ancestors2, function(ancestor, level) {
                if (!ancestor.tagName || !ancestor.parentNode || typeof ancestor.parentNode.tagName === "undefined") {
                  return;
                }
                if (typeof ancestor.readability === "undefined") {
                  this._initializeNode(ancestor);
                  candidates.push(ancestor);
                }
                if (level === 0) {
                  var scoreDivider = 1;
                } else if (level === 1) {
                  scoreDivider = 2;
                } else {
                  scoreDivider = level * 3;
                }
                ancestor.readability.contentScore += contentScore / scoreDivider;
              });
            });
            var topCandidates = [];
            for (var c = 0, cl = candidates.length; c < cl; c += 1) {
              var candidate = candidates[c];
              var candidateScore = candidate.readability.contentScore * (1 - this._getLinkDensity(candidate));
              candidate.readability.contentScore = candidateScore;
              this.log("Candidate:", candidate, "with score " + candidateScore);
              for (var t = 0; t < this._nbTopCandidates; t++) {
                var aTopCandidate = topCandidates[t];
                if (!aTopCandidate || candidateScore > aTopCandidate.readability.contentScore) {
                  topCandidates.splice(t, 0, candidate);
                  if (topCandidates.length > this._nbTopCandidates) {
                    topCandidates.pop();
                  }
                  break;
                }
              }
            }
            var topCandidate = topCandidates[0] || null;
            var neededToCreateTopCandidate = false;
            var parentOfTopCandidate;
            if (topCandidate === null || topCandidate.tagName === "BODY") {
              topCandidate = doc.createElement("DIV");
              neededToCreateTopCandidate = true;
              while (page.firstChild) {
                this.log("Moving child out:", page.firstChild);
                topCandidate.appendChild(page.firstChild);
              }
              page.appendChild(topCandidate);
              this._initializeNode(topCandidate);
            } else if (topCandidate) {
              var alternativeCandidateAncestors = [];
              for (var i = 1; i < topCandidates.length; i++) {
                if (topCandidates[i].readability.contentScore / topCandidate.readability.contentScore >= 0.75) {
                  alternativeCandidateAncestors.push(
                    this._getNodeAncestors(topCandidates[i])
                  );
                }
              }
              var MINIMUM_TOPCANDIDATES = 3;
              if (alternativeCandidateAncestors.length >= MINIMUM_TOPCANDIDATES) {
                parentOfTopCandidate = topCandidate.parentNode;
                while (parentOfTopCandidate.tagName !== "BODY") {
                  var listsContainingThisAncestor = 0;
                  for (var ancestorIndex = 0; ancestorIndex < alternativeCandidateAncestors.length && listsContainingThisAncestor < MINIMUM_TOPCANDIDATES; ancestorIndex++) {
                    listsContainingThisAncestor += Number(
                      alternativeCandidateAncestors[ancestorIndex].includes(
                        parentOfTopCandidate
                      )
                    );
                  }
                  if (listsContainingThisAncestor >= MINIMUM_TOPCANDIDATES) {
                    topCandidate = parentOfTopCandidate;
                    break;
                  }
                  parentOfTopCandidate = parentOfTopCandidate.parentNode;
                }
              }
              if (!topCandidate.readability) {
                this._initializeNode(topCandidate);
              }
              parentOfTopCandidate = topCandidate.parentNode;
              var lastScore = topCandidate.readability.contentScore;
              var scoreThreshold = lastScore / 3;
              while (parentOfTopCandidate.tagName !== "BODY") {
                if (!parentOfTopCandidate.readability) {
                  parentOfTopCandidate = parentOfTopCandidate.parentNode;
                  continue;
                }
                var parentScore = parentOfTopCandidate.readability.contentScore;
                if (parentScore < scoreThreshold) {
                  break;
                }
                if (parentScore > lastScore) {
                  topCandidate = parentOfTopCandidate;
                  break;
                }
                lastScore = parentOfTopCandidate.readability.contentScore;
                parentOfTopCandidate = parentOfTopCandidate.parentNode;
              }
              parentOfTopCandidate = topCandidate.parentNode;
              while (parentOfTopCandidate.tagName != "BODY" && parentOfTopCandidate.children.length == 1) {
                topCandidate = parentOfTopCandidate;
                parentOfTopCandidate = topCandidate.parentNode;
              }
              if (!topCandidate.readability) {
                this._initializeNode(topCandidate);
              }
            }
            var articleContent = doc.createElement("DIV");
            if (isPaging) {
              articleContent.id = "readability-content";
            }
            var siblingScoreThreshold = Math.max(
              10,
              topCandidate.readability.contentScore * 0.2
            );
            parentOfTopCandidate = topCandidate.parentNode;
            var siblings = parentOfTopCandidate.children;
            for (var s = 0, sl = siblings.length; s < sl; s++) {
              var sibling = siblings[s];
              var append = false;
              this.log(
                "Looking at sibling node:",
                sibling,
                sibling.readability ? "with score " + sibling.readability.contentScore : ""
              );
              this.log(
                "Sibling has score",
                sibling.readability ? sibling.readability.contentScore : "Unknown"
              );
              if (sibling === topCandidate) {
                append = true;
              } else {
                var contentBonus = 0;
                if (sibling.className === topCandidate.className && topCandidate.className !== "") {
                  contentBonus += topCandidate.readability.contentScore * 0.2;
                }
                if (sibling.readability && sibling.readability.contentScore + contentBonus >= siblingScoreThreshold) {
                  append = true;
                } else if (sibling.nodeName === "P") {
                  var linkDensity = this._getLinkDensity(sibling);
                  var nodeContent = this._getInnerText(sibling);
                  var nodeLength = nodeContent.length;
                  if (nodeLength > 80 && linkDensity < 0.25) {
                    append = true;
                  } else if (nodeLength < 80 && nodeLength > 0 && linkDensity === 0 && nodeContent.search(/\.( |$)/) !== -1) {
                    append = true;
                  }
                }
              }
              if (append) {
                this.log("Appending node:", sibling);
                if (!this.ALTER_TO_DIV_EXCEPTIONS.includes(sibling.nodeName)) {
                  this.log("Altering sibling:", sibling, "to div.");
                  sibling = this._setNodeTag(sibling, "DIV");
                }
                articleContent.appendChild(sibling);
                siblings = parentOfTopCandidate.children;
                s -= 1;
                sl -= 1;
              }
            }
            if (this._debug) {
              this.log("Article content pre-prep: " + articleContent.innerHTML);
            }
            this._prepArticle(articleContent);
            if (this._debug) {
              this.log("Article content post-prep: " + articleContent.innerHTML);
            }
            if (neededToCreateTopCandidate) {
              topCandidate.id = "readability-page-1";
              topCandidate.className = "page";
            } else {
              var div = doc.createElement("DIV");
              div.id = "readability-page-1";
              div.className = "page";
              while (articleContent.firstChild) {
                div.appendChild(articleContent.firstChild);
              }
              articleContent.appendChild(div);
            }
            if (this._debug) {
              this.log("Article content after paging: " + articleContent.innerHTML);
            }
            var parseSuccessful = true;
            var textLength = this._getInnerText(articleContent, true).length;
            if (textLength < this._charThreshold) {
              parseSuccessful = false;
              page.innerHTML = pageCacheHtml;
              this._attempts.push({
                articleContent,
                textLength
              });
              if (this._flagIsActive(this.FLAG_STRIP_UNLIKELYS)) {
                this._removeFlag(this.FLAG_STRIP_UNLIKELYS);
              } else if (this._flagIsActive(this.FLAG_WEIGHT_CLASSES)) {
                this._removeFlag(this.FLAG_WEIGHT_CLASSES);
              } else if (this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY)) {
                this._removeFlag(this.FLAG_CLEAN_CONDITIONALLY);
              } else {
                this._attempts.sort(function(a, b) {
                  return b.textLength - a.textLength;
                });
                if (!this._attempts[0].textLength) {
                  return null;
                }
                articleContent = this._attempts[0].articleContent;
                parseSuccessful = true;
              }
            }
            if (parseSuccessful) {
              var ancestors = [parentOfTopCandidate, topCandidate].concat(
                this._getNodeAncestors(parentOfTopCandidate)
              );
              this._someNode(ancestors, function(ancestor) {
                if (!ancestor.tagName) {
                  return false;
                }
                var articleDir = ancestor.getAttribute("dir");
                if (articleDir) {
                  this._articleDir = articleDir;
                  return true;
                }
                return false;
              });
              return articleContent;
            }
          }
        },
        /**
         * Converts some of the common HTML entities in string to their corresponding characters.
         *
         * @param str {string} - a string to unescape.
         * @return string without HTML entity.
         */
        _unescapeHtmlEntities(str) {
          if (!str) {
            return str;
          }
          var htmlEscapeMap = this.HTML_ESCAPE_MAP;
          return str.replace(/&(quot|amp|apos|lt|gt);/g, function(_, tag) {
            return htmlEscapeMap[tag];
          }).replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, function(_, hex, numStr) {
            var num = parseInt(hex || numStr, hex ? 16 : 10);
            if (num == 0 || num > 1114111 || num >= 55296 && num <= 57343) {
              num = 65533;
            }
            return String.fromCodePoint(num);
          });
        },
        /**
         * Try to extract metadata from JSON-LD object.
         * For now, only Schema.org objects of type Article or its subtypes are supported.
         * @return Object with any metadata that could be extracted (possibly none)
         */
        _getJSONLD(doc) {
          var scripts = this._getAllNodesWithTag(doc, ["script"]);
          var metadata;
          this._forEachNode(scripts, function(jsonLdElement) {
            if (!metadata && jsonLdElement.getAttribute("type") === "application/ld+json") {
              try {
                var content = jsonLdElement.textContent.replace(
                  /^\s*<!\[CDATA\[|\]\]>\s*$/g,
                  ""
                );
                var parsed = JSON.parse(content);
                if (Array.isArray(parsed)) {
                  parsed = parsed.find((it) => {
                    return it["@type"] && it["@type"].match(this.REGEXPS.jsonLdArticleTypes);
                  });
                  if (!parsed) {
                    return;
                  }
                }
                var schemaDotOrgRegex = /^https?\:\/\/schema\.org\/?$/;
                var matches = typeof parsed["@context"] === "string" && parsed["@context"].match(schemaDotOrgRegex) || typeof parsed["@context"] === "object" && typeof parsed["@context"]["@vocab"] == "string" && parsed["@context"]["@vocab"].match(schemaDotOrgRegex);
                if (!matches) {
                  return;
                }
                if (!parsed["@type"] && Array.isArray(parsed["@graph"])) {
                  parsed = parsed["@graph"].find((it) => {
                    return (it["@type"] || "").match(this.REGEXPS.jsonLdArticleTypes);
                  });
                }
                if (!parsed || !parsed["@type"] || !parsed["@type"].match(this.REGEXPS.jsonLdArticleTypes)) {
                  return;
                }
                metadata = {};
                if (typeof parsed.name === "string" && typeof parsed.headline === "string" && parsed.name !== parsed.headline) {
                  var title = this._getArticleTitle();
                  var nameMatches = this._textSimilarity(parsed.name, title) > 0.75;
                  var headlineMatches = this._textSimilarity(parsed.headline, title) > 0.75;
                  if (headlineMatches && !nameMatches) {
                    metadata.title = parsed.headline;
                  } else {
                    metadata.title = parsed.name;
                  }
                } else if (typeof parsed.name === "string") {
                  metadata.title = parsed.name.trim();
                } else if (typeof parsed.headline === "string") {
                  metadata.title = parsed.headline.trim();
                }
                if (parsed.author) {
                  if (typeof parsed.author.name === "string") {
                    metadata.byline = parsed.author.name.trim();
                  } else if (Array.isArray(parsed.author) && parsed.author[0] && typeof parsed.author[0].name === "string") {
                    metadata.byline = parsed.author.filter(function(author) {
                      return author && typeof author.name === "string";
                    }).map(function(author) {
                      return author.name.trim();
                    }).join(", ");
                  }
                }
                if (typeof parsed.description === "string") {
                  metadata.excerpt = parsed.description.trim();
                }
                if (parsed.publisher && typeof parsed.publisher.name === "string") {
                  metadata.siteName = parsed.publisher.name.trim();
                }
                if (typeof parsed.datePublished === "string") {
                  metadata.datePublished = parsed.datePublished.trim();
                }
              } catch (err) {
                this.log(err.message);
              }
            }
          });
          return metadata ? metadata : {};
        },
        /**
         * Attempts to get excerpt and byline metadata for the article.
         *
         * @param {Object} jsonld — object containing any metadata that
         * could be extracted from JSON-LD object.
         *
         * @return Object with optional "excerpt" and "byline" properties
         */
        _getArticleMetadata(jsonld) {
          var metadata = {};
          var values = {};
          var metaElements = this._doc.getElementsByTagName("meta");
          var propertyPattern = /\s*(article|dc|dcterm|og|twitter)\s*:\s*(author|creator|description|published_time|title|site_name)\s*/gi;
          var namePattern = /^\s*(?:(dc|dcterm|og|twitter|parsely|weibo:(article|webpage))\s*[-\.:]\s*)?(author|creator|pub-date|description|title|site_name)\s*$/i;
          this._forEachNode(metaElements, function(element) {
            var elementName = element.getAttribute("name");
            var elementProperty = element.getAttribute("property");
            var content = element.getAttribute("content");
            if (!content) {
              return;
            }
            var matches = null;
            var name = null;
            if (elementProperty) {
              matches = elementProperty.match(propertyPattern);
              if (matches) {
                name = matches[0].toLowerCase().replace(/\s/g, "");
                values[name] = content.trim();
              }
            }
            if (!matches && elementName && namePattern.test(elementName)) {
              name = elementName;
              if (content) {
                name = name.toLowerCase().replace(/\s/g, "").replace(/\./g, ":");
                values[name] = content.trim();
              }
            }
          });
          metadata.title = jsonld.title || values["dc:title"] || values["dcterm:title"] || values["og:title"] || values["weibo:article:title"] || values["weibo:webpage:title"] || values.title || values["twitter:title"] || values["parsely-title"];
          if (!metadata.title) {
            metadata.title = this._getArticleTitle();
          }
          const articleAuthor = typeof values["article:author"] === "string" && !this._isUrl(values["article:author"]) ? values["article:author"] : void 0;
          metadata.byline = jsonld.byline || values["dc:creator"] || values["dcterm:creator"] || values.author || values["parsely-author"] || articleAuthor;
          metadata.excerpt = jsonld.excerpt || values["dc:description"] || values["dcterm:description"] || values["og:description"] || values["weibo:article:description"] || values["weibo:webpage:description"] || values.description || values["twitter:description"];
          metadata.siteName = jsonld.siteName || values["og:site_name"];
          metadata.publishedTime = jsonld.datePublished || values["article:published_time"] || values["parsely-pub-date"] || null;
          metadata.title = this._unescapeHtmlEntities(metadata.title);
          metadata.byline = this._unescapeHtmlEntities(metadata.byline);
          metadata.excerpt = this._unescapeHtmlEntities(metadata.excerpt);
          metadata.siteName = this._unescapeHtmlEntities(metadata.siteName);
          metadata.publishedTime = this._unescapeHtmlEntities(metadata.publishedTime);
          return metadata;
        },
        /**
         * Check if node is image, or if node contains exactly only one image
         * whether as a direct child or as its descendants.
         *
         * @param Element
         **/
        _isSingleImage(node) {
          while (node) {
            if (node.tagName === "IMG") {
              return true;
            }
            if (node.children.length !== 1 || node.textContent.trim() !== "") {
              return false;
            }
            node = node.children[0];
          }
          return false;
        },
        /**
         * Find all <noscript> that are located after <img> nodes, and which contain only one
         * <img> element. Replace the first image with the image from inside the <noscript> tag,
         * and remove the <noscript> tag. This improves the quality of the images we use on
         * some sites (e.g. Medium).
         *
         * @param Element
         **/
        _unwrapNoscriptImages(doc) {
          var imgs = Array.from(doc.getElementsByTagName("img"));
          this._forEachNode(imgs, function(img) {
            for (var i = 0; i < img.attributes.length; i++) {
              var attr = img.attributes[i];
              switch (attr.name) {
                case "src":
                case "srcset":
                case "data-src":
                case "data-srcset":
                  return;
              }
              if (/\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
                return;
              }
            }
            img.remove();
          });
          var noscripts = Array.from(doc.getElementsByTagName("noscript"));
          this._forEachNode(noscripts, function(noscript) {
            if (!this._isSingleImage(noscript)) {
              return;
            }
            var tmp = doc.createElement("div");
            tmp.innerHTML = noscript.innerHTML;
            var prevElement = noscript.previousElementSibling;
            if (prevElement && this._isSingleImage(prevElement)) {
              var prevImg = prevElement;
              if (prevImg.tagName !== "IMG") {
                prevImg = prevElement.getElementsByTagName("img")[0];
              }
              var newImg = tmp.getElementsByTagName("img")[0];
              for (var i = 0; i < prevImg.attributes.length; i++) {
                var attr = prevImg.attributes[i];
                if (attr.value === "") {
                  continue;
                }
                if (attr.name === "src" || attr.name === "srcset" || /\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
                  if (newImg.getAttribute(attr.name) === attr.value) {
                    continue;
                  }
                  var attrName = attr.name;
                  if (newImg.hasAttribute(attrName)) {
                    attrName = "data-old-" + attrName;
                  }
                  newImg.setAttribute(attrName, attr.value);
                }
              }
              noscript.parentNode.replaceChild(tmp.firstElementChild, prevElement);
            }
          });
        },
        /**
         * Removes script tags from the document.
         *
         * @param Element
         **/
        _removeScripts(doc) {
          this._removeNodes(this._getAllNodesWithTag(doc, ["script", "noscript"]));
        },
        /**
         * Check if this node has only whitespace and a single element with given tag
         * Returns false if the DIV node contains non-empty text nodes
         * or if it contains no element with given tag or more than 1 element.
         *
         * @param Element
         * @param string tag of child element
         **/
        _hasSingleTagInsideElement(element, tag) {
          if (element.children.length != 1 || element.children[0].tagName !== tag) {
            return false;
          }
          return !this._someNode(element.childNodes, function(node) {
            return node.nodeType === this.TEXT_NODE && this.REGEXPS.hasContent.test(node.textContent);
          });
        },
        _isElementWithoutContent(node) {
          return node.nodeType === this.ELEMENT_NODE && !node.textContent.trim().length && (!node.children.length || node.children.length == node.getElementsByTagName("br").length + node.getElementsByTagName("hr").length);
        },
        /**
         * Determine whether element has any children block level elements.
         *
         * @param Element
         */
        _hasChildBlockElement(element) {
          return this._someNode(element.childNodes, function(node) {
            return this.DIV_TO_P_ELEMS.has(node.tagName) || this._hasChildBlockElement(node);
          });
        },
        /***
         * Determine if a node qualifies as phrasing content.
         * https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/Content_categories#Phrasing_content
         **/
        _isPhrasingContent(node) {
          return node.nodeType === this.TEXT_NODE || this.PHRASING_ELEMS.includes(node.tagName) || (node.tagName === "A" || node.tagName === "DEL" || node.tagName === "INS") && this._everyNode(node.childNodes, this._isPhrasingContent);
        },
        _isWhitespace(node) {
          return node.nodeType === this.TEXT_NODE && node.textContent.trim().length === 0 || node.nodeType === this.ELEMENT_NODE && node.tagName === "BR";
        },
        /**
         * Get the inner text of a node - cross browser compatibly.
         * This also strips out any excess whitespace to be found.
         *
         * @param Element
         * @param Boolean normalizeSpaces (default: true)
         * @return string
         **/
        _getInnerText(e, normalizeSpaces) {
          normalizeSpaces = typeof normalizeSpaces === "undefined" ? true : normalizeSpaces;
          var textContent = e.textContent.trim();
          if (normalizeSpaces) {
            return textContent.replace(this.REGEXPS.normalize, " ");
          }
          return textContent;
        },
        /**
         * Get the number of times a string s appears in the node e.
         *
         * @param Element
         * @param string - what to split on. Default is ","
         * @return number (integer)
         **/
        _getCharCount(e, s) {
          s = s || ",";
          return this._getInnerText(e).split(s).length - 1;
        },
        /**
         * Remove the style attribute on every e and under.
         * TODO: Test if getElementsByTagName(*) is faster.
         *
         * @param Element
         * @return void
         **/
        _cleanStyles(e) {
          if (!e || e.tagName.toLowerCase() === "svg") {
            return;
          }
          for (var i = 0; i < this.PRESENTATIONAL_ATTRIBUTES.length; i++) {
            e.removeAttribute(this.PRESENTATIONAL_ATTRIBUTES[i]);
          }
          if (this.DEPRECATED_SIZE_ATTRIBUTE_ELEMS.includes(e.tagName)) {
            e.removeAttribute("width");
            e.removeAttribute("height");
          }
          var cur = e.firstElementChild;
          while (cur !== null) {
            this._cleanStyles(cur);
            cur = cur.nextElementSibling;
          }
        },
        /**
         * Get the density of links as a percentage of the content
         * This is the amount of text that is inside a link divided by the total text in the node.
         *
         * @param Element
         * @return number (float)
         **/
        _getLinkDensity(element) {
          var textLength = this._getInnerText(element).length;
          if (textLength === 0) {
            return 0;
          }
          var linkLength = 0;
          this._forEachNode(element.getElementsByTagName("a"), function(linkNode) {
            var href = linkNode.getAttribute("href");
            var coefficient = href && this.REGEXPS.hashUrl.test(href) ? 0.3 : 1;
            linkLength += this._getInnerText(linkNode).length * coefficient;
          });
          return linkLength / textLength;
        },
        /**
         * Get an elements class/id weight. Uses regular expressions to tell if this
         * element looks good or bad.
         *
         * @param Element
         * @return number (Integer)
         **/
        _getClassWeight(e) {
          if (!this._flagIsActive(this.FLAG_WEIGHT_CLASSES)) {
            return 0;
          }
          var weight = 0;
          if (typeof e.className === "string" && e.className !== "") {
            if (this.REGEXPS.negative.test(e.className)) {
              weight -= 25;
            }
            if (this.REGEXPS.positive.test(e.className)) {
              weight += 25;
            }
          }
          if (typeof e.id === "string" && e.id !== "") {
            if (this.REGEXPS.negative.test(e.id)) {
              weight -= 25;
            }
            if (this.REGEXPS.positive.test(e.id)) {
              weight += 25;
            }
          }
          return weight;
        },
        /**
         * Clean a node of all elements of type "tag".
         * (Unless it's a youtube/vimeo video. People love movies.)
         *
         * @param Element
         * @param string tag to clean
         * @return void
         **/
        _clean(e, tag) {
          var isEmbed = ["object", "embed", "iframe"].includes(tag);
          this._removeNodes(this._getAllNodesWithTag(e, [tag]), function(element) {
            if (isEmbed) {
              for (var i = 0; i < element.attributes.length; i++) {
                if (this._allowedVideoRegex.test(element.attributes[i].value)) {
                  return false;
                }
              }
              if (element.tagName === "object" && this._allowedVideoRegex.test(element.innerHTML)) {
                return false;
              }
            }
            return true;
          });
        },
        /**
         * Check if a given node has one of its ancestor tag name matching the
         * provided one.
         * @param  HTMLElement node
         * @param  String      tagName
         * @param  Number      maxDepth
         * @param  Function    filterFn a filter to invoke to determine whether this node 'counts'
         * @return Boolean
         */
        _hasAncestorTag(node, tagName, maxDepth, filterFn) {
          maxDepth = maxDepth || 3;
          tagName = tagName.toUpperCase();
          var depth = 0;
          while (node.parentNode) {
            if (maxDepth > 0 && depth > maxDepth) {
              return false;
            }
            if (node.parentNode.tagName === tagName && (!filterFn || filterFn(node.parentNode))) {
              return true;
            }
            node = node.parentNode;
            depth++;
          }
          return false;
        },
        /**
         * Return an object indicating how many rows and columns this table has.
         */
        _getRowAndColumnCount(table) {
          var rows = 0;
          var columns = 0;
          var trs = table.getElementsByTagName("tr");
          for (var i = 0; i < trs.length; i++) {
            var rowspan = trs[i].getAttribute("rowspan") || 0;
            if (rowspan) {
              rowspan = parseInt(rowspan, 10);
            }
            rows += rowspan || 1;
            var columnsInThisRow = 0;
            var cells = trs[i].getElementsByTagName("td");
            for (var j = 0; j < cells.length; j++) {
              var colspan = cells[j].getAttribute("colspan") || 0;
              if (colspan) {
                colspan = parseInt(colspan, 10);
              }
              columnsInThisRow += colspan || 1;
            }
            columns = Math.max(columns, columnsInThisRow);
          }
          return { rows, columns };
        },
        /**
         * Look for 'data' (as opposed to 'layout') tables, for which we use
         * similar checks as
         * https://searchfox.org/mozilla-central/rev/f82d5c549f046cb64ce5602bfd894b7ae807c8f8/accessible/generic/TableAccessible.cpp#19
         */
        _markDataTables(root) {
          var tables = root.getElementsByTagName("table");
          for (var i = 0; i < tables.length; i++) {
            var table = tables[i];
            var role = table.getAttribute("role");
            if (role == "presentation") {
              table._readabilityDataTable = false;
              continue;
            }
            var datatable = table.getAttribute("datatable");
            if (datatable == "0") {
              table._readabilityDataTable = false;
              continue;
            }
            var summary = table.getAttribute("summary");
            if (summary) {
              table._readabilityDataTable = true;
              continue;
            }
            var caption = table.getElementsByTagName("caption")[0];
            if (caption && caption.childNodes.length) {
              table._readabilityDataTable = true;
              continue;
            }
            var dataTableDescendants = ["col", "colgroup", "tfoot", "thead", "th"];
            var descendantExists = function(tag) {
              return !!table.getElementsByTagName(tag)[0];
            };
            if (dataTableDescendants.some(descendantExists)) {
              this.log("Data table because found data-y descendant");
              table._readabilityDataTable = true;
              continue;
            }
            if (table.getElementsByTagName("table")[0]) {
              table._readabilityDataTable = false;
              continue;
            }
            var sizeInfo = this._getRowAndColumnCount(table);
            if (sizeInfo.columns == 1 || sizeInfo.rows == 1) {
              table._readabilityDataTable = false;
              continue;
            }
            if (sizeInfo.rows >= 10 || sizeInfo.columns > 4) {
              table._readabilityDataTable = true;
              continue;
            }
            table._readabilityDataTable = sizeInfo.rows * sizeInfo.columns > 10;
          }
        },
        /* convert images and figures that have properties like data-src into images that can be loaded without JS */
        _fixLazyImages(root) {
          this._forEachNode(
            this._getAllNodesWithTag(root, ["img", "picture", "figure"]),
            function(elem) {
              if (elem.src && this.REGEXPS.b64DataUrl.test(elem.src)) {
                var parts = this.REGEXPS.b64DataUrl.exec(elem.src);
                if (parts[1] === "image/svg+xml") {
                  return;
                }
                var srcCouldBeRemoved = false;
                for (var i = 0; i < elem.attributes.length; i++) {
                  var attr = elem.attributes[i];
                  if (attr.name === "src") {
                    continue;
                  }
                  if (/\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
                    srcCouldBeRemoved = true;
                    break;
                  }
                }
                if (srcCouldBeRemoved) {
                  var b64starts = parts[0].length;
                  var b64length = elem.src.length - b64starts;
                  if (b64length < 133) {
                    elem.removeAttribute("src");
                  }
                }
              }
              if ((elem.src || elem.srcset && elem.srcset != "null") && !elem.className.toLowerCase().includes("lazy")) {
                return;
              }
              for (var j = 0; j < elem.attributes.length; j++) {
                attr = elem.attributes[j];
                if (attr.name === "src" || attr.name === "srcset" || attr.name === "alt") {
                  continue;
                }
                var copyTo = null;
                if (/\.(jpg|jpeg|png|webp)\s+\d/.test(attr.value)) {
                  copyTo = "srcset";
                } else if (/^\s*\S+\.(jpg|jpeg|png|webp)\S*\s*$/.test(attr.value)) {
                  copyTo = "src";
                }
                if (copyTo) {
                  if (elem.tagName === "IMG" || elem.tagName === "PICTURE") {
                    elem.setAttribute(copyTo, attr.value);
                  } else if (elem.tagName === "FIGURE" && !this._getAllNodesWithTag(elem, ["img", "picture"]).length) {
                    var img = this._doc.createElement("img");
                    img.setAttribute(copyTo, attr.value);
                    elem.appendChild(img);
                  }
                }
              }
            }
          );
        },
        _getTextDensity(e, tags) {
          var textLength = this._getInnerText(e, true).length;
          if (textLength === 0) {
            return 0;
          }
          var childrenLength = 0;
          var children = this._getAllNodesWithTag(e, tags);
          this._forEachNode(
            children,
            (child) => childrenLength += this._getInnerText(child, true).length
          );
          return childrenLength / textLength;
        },
        /**
         * Clean an element of all tags of type "tag" if they look fishy.
         * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
         *
         * @return void
         **/
        _cleanConditionally(e, tag) {
          if (!this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY)) {
            return;
          }
          this._removeNodes(this._getAllNodesWithTag(e, [tag]), function(node) {
            var isDataTable = function(t) {
              return t._readabilityDataTable;
            };
            var isList = tag === "ul" || tag === "ol";
            if (!isList) {
              var listLength = 0;
              var listNodes = this._getAllNodesWithTag(node, ["ul", "ol"]);
              this._forEachNode(
                listNodes,
                (list) => listLength += this._getInnerText(list).length
              );
              isList = listLength / this._getInnerText(node).length > 0.9;
            }
            if (tag === "table" && isDataTable(node)) {
              return false;
            }
            if (this._hasAncestorTag(node, "table", -1, isDataTable)) {
              return false;
            }
            if (this._hasAncestorTag(node, "code")) {
              return false;
            }
            if ([...node.getElementsByTagName("table")].some(
              (tbl) => tbl._readabilityDataTable
            )) {
              return false;
            }
            var weight = this._getClassWeight(node);
            this.log("Cleaning Conditionally", node);
            var contentScore = 0;
            if (weight + contentScore < 0) {
              return true;
            }
            if (this._getCharCount(node, ",") < 10) {
              var p = node.getElementsByTagName("p").length;
              var img = node.getElementsByTagName("img").length;
              var li = node.getElementsByTagName("li").length - 100;
              var input = node.getElementsByTagName("input").length;
              var headingDensity = this._getTextDensity(node, [
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6"
              ]);
              var embedCount = 0;
              var embeds = this._getAllNodesWithTag(node, [
                "object",
                "embed",
                "iframe"
              ]);
              for (var i = 0; i < embeds.length; i++) {
                for (var j = 0; j < embeds[i].attributes.length; j++) {
                  if (this._allowedVideoRegex.test(embeds[i].attributes[j].value)) {
                    return false;
                  }
                }
                if (embeds[i].tagName === "object" && this._allowedVideoRegex.test(embeds[i].innerHTML)) {
                  return false;
                }
                embedCount++;
              }
              var innerText = this._getInnerText(node);
              if (this.REGEXPS.adWords.test(innerText) || this.REGEXPS.loadingWords.test(innerText)) {
                return true;
              }
              var contentLength = innerText.length;
              var linkDensity = this._getLinkDensity(node);
              var textishTags = ["SPAN", "LI", "TD"].concat(
                Array.from(this.DIV_TO_P_ELEMS)
              );
              var textDensity = this._getTextDensity(node, textishTags);
              var isFigureChild = this._hasAncestorTag(node, "figure");
              const shouldRemoveNode = () => {
                const errs = [];
                if (!isFigureChild && img > 1 && p / img < 0.5) {
                  errs.push(`Bad p to img ratio (img=${img}, p=${p})`);
                }
                if (!isList && li > p) {
                  errs.push(`Too many li's outside of a list. (li=${li} > p=${p})`);
                }
                if (input > Math.floor(p / 3)) {
                  errs.push(`Too many inputs per p. (input=${input}, p=${p})`);
                }
                if (!isList && !isFigureChild && headingDensity < 0.9 && contentLength < 25 && (img === 0 || img > 2) && linkDensity > 0) {
                  errs.push(
                    `Suspiciously short. (headingDensity=${headingDensity}, img=${img}, linkDensity=${linkDensity})`
                  );
                }
                if (!isList && weight < 25 && linkDensity > 0.2 + this._linkDensityModifier) {
                  errs.push(
                    `Low weight and a little linky. (linkDensity=${linkDensity})`
                  );
                }
                if (weight >= 25 && linkDensity > 0.5 + this._linkDensityModifier) {
                  errs.push(
                    `High weight and mostly links. (linkDensity=${linkDensity})`
                  );
                }
                if (embedCount === 1 && contentLength < 75 || embedCount > 1) {
                  errs.push(
                    `Suspicious embed. (embedCount=${embedCount}, contentLength=${contentLength})`
                  );
                }
                if (img === 0 && textDensity === 0) {
                  errs.push(
                    `No useful content. (img=${img}, textDensity=${textDensity})`
                  );
                }
                if (errs.length) {
                  this.log("Checks failed", errs);
                  return true;
                }
                return false;
              };
              var haveToRemove = shouldRemoveNode();
              if (isList && haveToRemove) {
                for (var x = 0; x < node.children.length; x++) {
                  let child = node.children[x];
                  if (child.children.length > 1) {
                    return haveToRemove;
                  }
                }
                let li_count = node.getElementsByTagName("li").length;
                if (img == li_count) {
                  return false;
                }
              }
              return haveToRemove;
            }
            return false;
          });
        },
        /**
         * Clean out elements that match the specified conditions
         *
         * @param Element
         * @param Function determines whether a node should be removed
         * @return void
         **/
        _cleanMatchedNodes(e, filter) {
          var endOfSearchMarkerNode = this._getNextNode(e, true);
          var next = this._getNextNode(e);
          while (next && next != endOfSearchMarkerNode) {
            if (filter.call(this, next, next.className + " " + next.id)) {
              next = this._removeAndGetNext(next);
            } else {
              next = this._getNextNode(next);
            }
          }
        },
        /**
         * Clean out spurious headers from an Element.
         *
         * @param Element
         * @return void
         **/
        _cleanHeaders(e) {
          let headingNodes = this._getAllNodesWithTag(e, ["h1", "h2"]);
          this._removeNodes(headingNodes, function(node) {
            let shouldRemove = this._getClassWeight(node) < 0;
            if (shouldRemove) {
              this.log("Removing header with low class weight:", node);
            }
            return shouldRemove;
          });
        },
        /**
         * Check if this node is an H1 or H2 element whose content is mostly
         * the same as the article title.
         *
         * @param Element  the node to check.
         * @return boolean indicating whether this is a title-like header.
         */
        _headerDuplicatesTitle(node) {
          if (node.tagName != "H1" && node.tagName != "H2") {
            return false;
          }
          var heading = this._getInnerText(node, false);
          this.log("Evaluating similarity of header:", heading, this._articleTitle);
          return this._textSimilarity(this._articleTitle, heading) > 0.75;
        },
        _flagIsActive(flag) {
          return (this._flags & flag) > 0;
        },
        _removeFlag(flag) {
          this._flags = this._flags & ~flag;
        },
        _isProbablyVisible(node) {
          return (!node.style || node.style.display != "none") && (!node.style || node.style.visibility != "hidden") && !node.hasAttribute("hidden") && //check for "fallback-image" so that wikimedia math images are displayed
          (!node.hasAttribute("aria-hidden") || node.getAttribute("aria-hidden") != "true" || node.className && node.className.includes && node.className.includes("fallback-image"));
        },
        /**
         * Runs readability.
         *
         * Workflow:
         *  1. Prep the document by removing script tags, css, etc.
         *  2. Build readability's DOM tree.
         *  3. Grab the article content from the current dom tree.
         *  4. Replace the current DOM tree with the new one.
         *  5. Read peacefully.
         *
         * @return void
         **/
        parse() {
          if (this._maxElemsToParse > 0) {
            var numTags = this._doc.getElementsByTagName("*").length;
            if (numTags > this._maxElemsToParse) {
              throw new Error(
                "Aborting parsing document; " + numTags + " elements found"
              );
            }
          }
          this._unwrapNoscriptImages(this._doc);
          var jsonLd = this._disableJSONLD ? {} : this._getJSONLD(this._doc);
          this._removeScripts(this._doc);
          this._prepDocument();
          var metadata = this._getArticleMetadata(jsonLd);
          this._metadata = metadata;
          this._articleTitle = metadata.title;
          var articleContent = this._grabArticle();
          if (!articleContent) {
            return null;
          }
          this.log("Grabbed: " + articleContent.innerHTML);
          this._postProcessContent(articleContent);
          if (!metadata.excerpt) {
            var paragraphs = articleContent.getElementsByTagName("p");
            if (paragraphs.length) {
              metadata.excerpt = paragraphs[0].textContent.trim();
            }
          }
          var textContent = articleContent.textContent;
          return {
            title: this._articleTitle,
            byline: metadata.byline || this._articleByline,
            dir: this._articleDir,
            lang: this._articleLang,
            content: this._serializer(articleContent),
            textContent,
            length: textContent.length,
            excerpt: metadata.excerpt,
            siteName: metadata.siteName || this._articleSiteName,
            publishedTime: metadata.publishedTime
          };
        }
      };
      if (typeof module === "object") {
        module.exports = Readability2;
      }
    }
  });

  // node_modules/@mozilla/readability/Readability-readerable.js
  var require_Readability_readerable = __commonJS({
    "node_modules/@mozilla/readability/Readability-readerable.js"(exports, module) {
      var REGEXPS = {
        // NOTE: These two regular expressions are duplicated in
        // Readability.js. Please keep both copies in sync.
        unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
        okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i
      };
      function isNodeVisible(node) {
        return (!node.style || node.style.display != "none") && !node.hasAttribute("hidden") && //check for "fallback-image" so that wikimedia math images are displayed
        (!node.hasAttribute("aria-hidden") || node.getAttribute("aria-hidden") != "true" || node.className && node.className.includes && node.className.includes("fallback-image"));
      }
      function isProbablyReaderable(doc, options = {}) {
        if (typeof options == "function") {
          options = { visibilityChecker: options };
        }
        var defaultOptions = {
          minScore: 20,
          minContentLength: 140,
          visibilityChecker: isNodeVisible
        };
        options = Object.assign(defaultOptions, options);
        var nodes = doc.querySelectorAll("p, pre, article");
        var brNodes = doc.querySelectorAll("div > br");
        if (brNodes.length) {
          var set = new Set(nodes);
          [].forEach.call(brNodes, function(node) {
            set.add(node.parentNode);
          });
          nodes = Array.from(set);
        }
        var score = 0;
        return [].some.call(nodes, function(node) {
          if (!options.visibilityChecker(node)) {
            return false;
          }
          var matchString = node.className + " " + node.id;
          if (REGEXPS.unlikelyCandidates.test(matchString) && !REGEXPS.okMaybeItsACandidate.test(matchString)) {
            return false;
          }
          if (node.matches("li p")) {
            return false;
          }
          var textContentLength = node.textContent.trim().length;
          if (textContentLength < options.minContentLength) {
            return false;
          }
          score += Math.sqrt(textContentLength - options.minContentLength);
          if (score > options.minScore) {
            return true;
          }
          return false;
        });
      }
      if (typeof module === "object") {
        module.exports = isProbablyReaderable;
      }
    }
  });

  // node_modules/@mozilla/readability/index.js
  var require_readability = __commonJS({
    "node_modules/@mozilla/readability/index.js"(exports, module) {
      var Readability2 = require_Readability();
      var isProbablyReaderable = require_Readability_readerable();
      module.exports = {
        Readability: Readability2,
        isProbablyReaderable
      };
    }
  });

  // src/webview/injector.ts
  var import_readability = __toESM(require_readability(), 1);

  // node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
  function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  }
  function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  }

  // node_modules/@tauri-apps/api/core.js
  var _Channel_onmessage;
  var _Channel_nextMessageIndex;
  var _Channel_pendingMessages;
  var _Channel_messageEndIndex;
  var _Resource_rid;
  var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
  function transformCallback(callback, once = false) {
    return window.__TAURI_INTERNALS__.transformCallback(callback, once);
  }
  var Channel = class {
    constructor(onmessage) {
      _Channel_onmessage.set(this, void 0);
      _Channel_nextMessageIndex.set(this, 0);
      _Channel_pendingMessages.set(this, []);
      _Channel_messageEndIndex.set(this, void 0);
      __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
      }), "f");
      this.id = transformCallback((rawMessage) => {
        const index = rawMessage.index;
        if ("end" in rawMessage) {
          if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
            this.cleanupCallback();
          } else {
            __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
          }
          return;
        }
        const message = rawMessage.message;
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
            const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
            delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          }
          if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
            this.cleanupCallback();
          }
        } else {
          __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
        }
      });
    }
    cleanupCallback() {
      window.__TAURI_INTERNALS__.unregisterCallback(this.id);
    }
    set onmessage(handler) {
      __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
    }
    get onmessage() {
      return __classPrivateFieldGet(this, _Channel_onmessage, "f");
    }
    [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
      return `__CHANNEL__:${this.id}`;
    }
    toJSON() {
      return this[SERIALIZE_TO_IPC_FN]();
    }
  };
  async function invoke(cmd, args = {}, options) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
  }
  function convertFileSrc(filePath, protocol = "asset") {
    return window.__TAURI_INTERNALS__.convertFileSrc(filePath, protocol);
  }
  _Resource_rid = /* @__PURE__ */ new WeakMap();

  // node_modules/@tauri-apps/api/event.js
  var TauriEvent;
  (function(TauriEvent2) {
    TauriEvent2["WINDOW_RESIZED"] = "tauri://resize";
    TauriEvent2["WINDOW_MOVED"] = "tauri://move";
    TauriEvent2["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
    TauriEvent2["WINDOW_DESTROYED"] = "tauri://destroyed";
    TauriEvent2["WINDOW_FOCUS"] = "tauri://focus";
    TauriEvent2["WINDOW_BLUR"] = "tauri://blur";
    TauriEvent2["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
    TauriEvent2["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
    TauriEvent2["WINDOW_CREATED"] = "tauri://window-created";
    TauriEvent2["WEBVIEW_CREATED"] = "tauri://webview-created";
    TauriEvent2["DRAG_ENTER"] = "tauri://drag-enter";
    TauriEvent2["DRAG_OVER"] = "tauri://drag-over";
    TauriEvent2["DRAG_DROP"] = "tauri://drag-drop";
    TauriEvent2["DRAG_LEAVE"] = "tauri://drag-leave";
  })(TauriEvent || (TauriEvent = {}));
  async function _unlisten(event, eventId) {
    window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
    await invoke("plugin:event|unlisten", {
      event,
      eventId
    });
  }
  async function listen(event, handler, options) {
    var _a;
    const target = typeof (options === null || options === void 0 ? void 0 : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === void 0 ? void 0 : options.target) !== null && _a !== void 0 ? _a : { kind: "Any" };
    return invoke("plugin:event|listen", {
      event,
      target,
      handler: transformCallback(handler)
    }).then((eventId) => {
      return async () => _unlisten(event, eventId);
    });
  }

  // src/webview/injector.ts
  var ASSET_URI_PREFIX = "asset://";
  (async () => {
    const installState = window;
    if (installState.__aimdWebClipInstalled || installState.__aimdWebClipInstalling) return;
    installState.__aimdWebClipInstalling = true;
    try {
      await waitForDocumentShell();
    } catch (err) {
      installState.__aimdWebClipInstalling = false;
      throw err;
    }
    installState.__aimdWebClipInstalled = true;
    installState.__aimdWebClipInstalling = false;
    const diagnostics = [];
    let currentDoc = null;
    let extracting = false;
    const record = (level, message, data) => {
      diagnostics.push({ level, message, data });
      const args = data === void 0 ? [`[web-clip:extractor] ${message}`] : [`[web-clip:extractor] ${message}`, data];
      if (level === "debug") console.debug(...args);
      else if (level === "info") console.info(...args);
      else if (level === "warn") console.warn(...args);
      else console.error(...args);
    };
    const style = document.createElement("style");
    style.textContent = `
    .aimd-clip-shell, .aimd-clip-shell * { box-sizing: border-box; }
    .aimd-clip-shell [hidden] { display: none !important; }
    .aimd-clip-shell { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #15171c; letter-spacing: 0; }
    .aimd-clip-bar { position: fixed; z-index: 3; top: 18px; left: 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 40px)); min-height: 48px; display: grid; grid-template-columns: minmax(180px, 1fr) auto auto; align-items: center; gap: 8px; padding: 7px; border: 1px solid rgba(255,255,255,.72); border-radius: 14px; background: linear-gradient(135deg, rgba(255,255,255,.9), rgba(245,247,250,.78)); box-shadow: 0 22px 62px rgba(19, 24, 36, .2), inset 0 1px 0 rgba(255,255,255,.86); backdrop-filter: blur(22px) saturate(1.18); pointer-events: auto; }
    .aimd-clip-bar::before { content: ""; position: absolute; inset: -1px; z-index: -1; border-radius: 15px; background: linear-gradient(120deg, rgba(22,163,255,.42), rgba(142,68,255,.34), rgba(255,68,165,.32), rgba(255,183,77,.28), rgba(22,163,255,.42)); background-size: 240% 240%; opacity: .72; filter: blur(10px); animation: aimdAura 6s ease-in-out infinite; pointer-events: none; }
    .aimd-clip-url { width: 100%; min-width: 0; border: 1px solid rgba(24, 27, 32, .14); border-radius: 9px; padding: 0 12px; color: #17191f !important; background: rgba(255,255,255,.94) !important; font: 520 13px/36px inherit; outline: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.72); }
    .aimd-clip-url:focus { border-color: #2f343d; box-shadow: 0 0 0 3px rgba(24, 27, 32, .08); }
    .aimd-clip-btn { position: relative; isolation: isolate; overflow: hidden; height: 36px; border: 0 !important; border-radius: 9px; padding: 0 15px; background: #151822 !important; color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 1px rgba(0,0,0,.24); font: 740 13px/36px inherit; cursor: pointer; white-space: nowrap; box-shadow: 0 10px 24px rgba(38, 47, 71, .28), inset 0 1px 0 rgba(255,255,255,.18); transition: transform .16s ease, filter .16s ease, opacity .16s ease; }
    .aimd-clip-btn:not(.secondary)::before { content: ""; position: absolute; inset: -2px; z-index: -2; border-radius: inherit; background: linear-gradient(110deg, #23d5ff 0%, #7b61ff 26%, #ff4fab 52%, #ffb457 76%, #23d5ff 100%); background-size: 260% 260%; animation: aimdAura 4.8s ease-in-out infinite; }
    .aimd-clip-btn:not(.secondary)::after { content: ""; position: absolute; inset: 1px; z-index: -1; border-radius: 8px; background: linear-gradient(180deg, rgba(27,31,43,.92), rgba(15,17,24,.94)); box-shadow: inset 0 1px 0 rgba(255,255,255,.18); }
    .aimd-clip-btn:hover { filter: brightness(1.06) saturate(1.08); }
    .aimd-clip-btn:active { transform: translateY(1px); }
    .aimd-clip-btn.secondary { background: #e9ecef !important; color: #30343b !important; -webkit-text-fill-color: #30343b !important; text-shadow: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.72); }
    .aimd-clip-btn.secondary:hover { background: #dde1e5; }
    .aimd-clip-btn:disabled { opacity: .55; cursor: default; transform: none; }
    .aimd-clip-start, .aimd-clip-work, .aimd-clip-preview { position: fixed; z-index: 1; inset: 0; pointer-events: auto; }
    .aimd-clip-start { display: grid; align-items: center; padding: 56px clamp(24px, 7vw, 112px); background: radial-gradient(circle at 14% 18%, rgba(35,213,255,.18), transparent 34%), radial-gradient(circle at 78% 28%, rgba(255,79,171,.14), transparent 30%), radial-gradient(circle at 72% 82%, rgba(255,180,87,.14), transparent 34%), linear-gradient(180deg, #fafaf8 0%, #eff1ee 100%); }
    .aimd-clip-start::before { content: ""; position: absolute; inset: 0; opacity: .34; background-image: linear-gradient(rgba(23,25,31,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(23,25,31,.05) 1px, transparent 1px); background-size: 34px 34px; pointer-events: none; }
    .aimd-clip-card { position: relative; width: min(760px, 100%); padding: 34px; border: 1px solid rgba(255,255,255,.74); border-radius: 16px; background: linear-gradient(145deg, rgba(255,255,255,.92), rgba(250,251,253,.84)); box-shadow: 0 30px 96px rgba(20, 23, 28, .15), inset 0 1px 0 rgba(255,255,255,.92); pointer-events: auto; backdrop-filter: blur(16px) saturate(1.12); }
    .aimd-clip-card::before { content: ""; position: absolute; inset: -1px; z-index: -1; border-radius: 17px; background: linear-gradient(130deg, rgba(35,213,255,.46), rgba(123,97,255,.25), rgba(255,79,171,.32), rgba(255,180,87,.28)); filter: blur(12px); opacity: .55; pointer-events: none; }
    .aimd-clip-card h1 { margin: 0 0 10px; font: 760 30px/1.15 inherit; color: #15171c; letter-spacing: 0; }
    .aimd-clip-card p { max-width: 560px; margin: 0 0 24px; color: #646a73; font: 450 14px/1.7 inherit; }
    .aimd-clip-home-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; }
    .aimd-clip-home-field { min-width: 0; }
    .aimd-clip-label { display: block; margin: 0 0 8px; color: #444a53; font: 680 12px/1.2 inherit; }
    .aimd-clip-home-form .aimd-clip-url { height: 46px; font-size: 15px; line-height: 46px; }
    .aimd-clip-home-form .aimd-clip-btn { height: 46px; min-width: 104px; line-height: 46px; }
    .aimd-clip-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; color: #6d737c; font: 520 12px/1.2 inherit; }
    .aimd-clip-meta span { border: 1px solid rgba(24, 27, 32, .1); border-radius: 999px; padding: 7px 10px; background: rgba(248,248,246,.8); }
    .aimd-clip-work { display: grid; place-items: center; padding: 32px; background: rgba(246,247,244,.96); backdrop-filter: blur(8px); }
    .aimd-clip-work-card { width: min(520px, 100%); border: 1px solid rgba(24,27,32,.12); border-radius: 14px; padding: 28px; background: #fff; box-shadow: 0 24px 80px rgba(20,23,28,.16); }
    .aimd-clip-skeleton { display: grid; gap: 10px; margin-bottom: 22px; }
    .aimd-clip-skeleton span { height: 12px; border-radius: 999px; background: linear-gradient(90deg, #ecefeb 0%, #f8f8f6 45%, #ecefeb 100%); background-size: 220% 100%; animation: aimdShimmer 1.4s ease-in-out infinite; }
    .aimd-clip-skeleton span:nth-child(1) { width: 72%; height: 16px; }
    .aimd-clip-skeleton span:nth-child(2) { width: 94%; }
    .aimd-clip-skeleton span:nth-child(3) { width: 82%; }
    .aimd-clip-work-text { color: #15171c; font: 720 16px/1.4 inherit; }
    .aimd-clip-work-sub { margin-top: 6px; color: #747a83; font: 13px/1.5 inherit; }
    .aimd-clip-preview { overflow: auto; padding: 88px 24px 32px; background: #f4f5f1; }
    .aimd-clip-preview-inner { width: min(920px, 100%); margin: 0 auto; padding: 34px 38px 52px; border: 1px solid rgba(24, 27, 32, .1); border-radius: 12px; background: #fff; color: #20242b; box-shadow: 0 24px 70px rgba(20,23,28,.12); }
    .aimd-clip-preview-inner h1 { font-size: 30px; line-height: 1.2; margin: 0 0 18px; }
    .aimd-clip-preview-inner h2 { font-size: 21px; margin: 28px 0 12px; }
    .aimd-clip-preview-inner h3 { font-size: 17px; margin: 22px 0 10px; }
    .aimd-clip-preview-inner p, .aimd-clip-preview-inner li { font-size: 15px; line-height: 1.75; }
    .aimd-clip-preview-inner img { max-width: 100%; height: auto; border-radius: 8px; }
    @media (max-width: 720px) {
      .aimd-clip-bar { top: 10px; width: calc(100vw - 20px); grid-template-columns: 1fr auto; }
      .aimd-clip-bar .aimd-clip-btn.secondary { display: none; }
      .aimd-clip-start { padding: 24px; }
      .aimd-clip-card { padding: 24px; }
      .aimd-clip-card h1 { font-size: 24px; }
      .aimd-clip-home-form { grid-template-columns: 1fr; }
      .aimd-clip-home-form .aimd-clip-btn { width: 100%; }
      .aimd-clip-preview-inner { padding: 26px 22px 40px; }
    }
    @keyframes aimdShimmer { 0% { background-position: 120% 0; } 100% { background-position: -120% 0; } }
    @keyframes aimdAura { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
  `;
    document.head.appendChild(style);
    const shell = document.createElement("div");
    shell.className = "aimd-clip-shell";
    shell.innerHTML = `
    <div class="aimd-clip-bar" hidden>
      <input class="aimd-clip-url" type="url" placeholder="https://example.com/article" />
      <button class="aimd-clip-btn" data-action="load">\u786E\u5B9A</button>
      <button class="aimd-clip-btn secondary" data-action="cancel">\u53D6\u6D88</button>
    </div>
    <div class="aimd-clip-start">
      <div class="aimd-clip-card">
        <h1>\u4E00\u952E\u63D0\u53D6\u7F51\u9875</h1>
        <p>\u7C98\u8D34\u6587\u7AE0\u94FE\u63A5\uFF0C\u5148\u6253\u5F00\u7F51\u9875\u786E\u8BA4\u5185\u5BB9\uFF0C\u518D\u63D0\u53D6\u6210 AIMD \u8349\u7A3F\u3002</p>
        <div class="aimd-clip-home-form">
          <div class="aimd-clip-home-field">
            <label class="aimd-clip-label" for="aimd-clip-home-url">\u7F51\u9875 URL</label>
            <input id="aimd-clip-home-url" class="aimd-clip-url" data-role="home-url" type="url" placeholder="https://example.com/article" />
          </div>
          <button class="aimd-clip-btn" data-action="home-load">\u786E\u5B9A</button>
        </div>
        <div class="aimd-clip-meta">
          <span>\u5148\u6D4F\u89C8\u539F\u7F51\u9875</span>
          <span>\u518D\u751F\u6210\u9884\u89C8</span>
          <span>\u786E\u8BA4\u540E\u5199\u5165\u4E3B\u7A97\u53E3</span>
        </div>
      </div>
    </div>
    <div class="aimd-clip-work" hidden>
      <div class="aimd-clip-work-card">
        <div class="aimd-clip-skeleton">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="aimd-clip-work-text">\u5927\u6A21\u578B\u6B63\u5728\u683C\u5F0F\u5316</div>
        <div class="aimd-clip-work-sub">\u6B63\u5728\u6E05\u7406\u6B63\u6587\u3001\u4E0B\u8F7D\u56FE\u7247\u5E76\u751F\u6210\u9884\u89C8</div>
      </div>
    </div>
    <div class="aimd-clip-preview" hidden>
      <div class="aimd-clip-preview-inner"></div>
    </div>
  `;
    function mount() {
      if (document.body && !document.body.contains(shell)) {
        document.body.appendChild(shell);
        const target = isExtractEntryPage() ? "" : isRemotePage() ? getTargetURL() || location.href : "";
        if (target) {
          clipBar.hidden = false;
          urlInput.value = target;
          homeUrlInput.value = target;
          startPanel.hidden = true;
          loadBtn.textContent = "\u667A\u80FD\u63D0\u53D6";
          loadBtn.dataset.action = "extract";
        } else if (isExtractEntryPage() || !isRemotePage()) {
          clipBar.hidden = true;
          startPanel.hidden = false;
          loadBtn.textContent = "\u786E\u5B9A";
          loadBtn.dataset.action = "load";
          window.setTimeout(() => homeUrlInput.focus(), 50);
        }
      } else if (!document.body) {
        setTimeout(mount, 50);
      }
    }
    function waitForDocumentShell() {
      if (document.head && document.body) return Promise.resolve();
      return new Promise((resolve) => {
        const tryResolve = () => {
          if (!document.head || !document.body) return false;
          document.removeEventListener("DOMContentLoaded", tryResolve);
          resolve();
          return true;
        };
        if (tryResolve()) return;
        document.addEventListener("DOMContentLoaded", tryResolve);
        const timer = window.setInterval(() => {
          if (tryResolve()) window.clearInterval(timer);
        }, 20);
      });
    }
    const urlInput = shell.querySelector(".aimd-clip-url");
    const homeUrlInput = shell.querySelector('[data-role="home-url"]');
    const clipBar = shell.querySelector(".aimd-clip-bar");
    const loadBtn = shell.querySelector('[data-action="load"]');
    const homeLoadBtn = shell.querySelector('[data-action="home-load"]');
    const cancelBtn = shell.querySelector('[data-action="cancel"]');
    const startPanel = shell.querySelector(".aimd-clip-start");
    const workPanel = shell.querySelector(".aimd-clip-work");
    const previewPanel = shell.querySelector(".aimd-clip-preview");
    const previewInner = shell.querySelector(".aimd-clip-preview-inner");
    mount();
    await listen("web_clip_preview_ready", (event) => {
      currentDoc = event.payload;
      workPanel.hidden = true;
      previewPanel.hidden = false;
      previewInner.innerHTML = rewriteAssetURLs(currentDoc.html, currentDoc.assets || []);
      loadBtn.textContent = "\u786E\u5B9A";
      loadBtn.dataset.action = "accept";
      loadBtn.disabled = false;
    });
    await listen("web_clip_preview_failed", (event) => {
      workPanel.hidden = false;
      workPanel.innerHTML = `<div><div class="aimd-clip-work-text">\u63D0\u53D6\u5931\u8D25</div><div class="aimd-clip-work-sub">${escapeHTML(event.payload?.error || "\u672A\u77E5\u9519\u8BEF")}</div></div>`;
      loadBtn.textContent = "\u667A\u80FD\u63D0\u53D6";
      loadBtn.dataset.action = "extract";
      loadBtn.disabled = false;
    });
    loadBtn.addEventListener("click", () => {
      const action = loadBtn.dataset.action;
      if (action === "load") {
        loadURLFromInput(urlInput);
        return;
      }
      if (action === "extract") {
        void runExtraction();
        return;
      }
      if (action === "accept" && currentDoc) {
        void invoke("web_clip_accept", { doc: currentDoc });
      }
    });
    homeLoadBtn.addEventListener("click", () => {
      loadURLFromInput(homeUrlInput);
    });
    urlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadBtn.click();
      }
    });
    urlInput.addEventListener("input", () => {
      homeUrlInput.value = urlInput.value;
    });
    homeUrlInput.addEventListener("input", () => {
      urlInput.value = homeUrlInput.value;
    });
    homeUrlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        homeLoadBtn.click();
      }
    });
    cancelBtn.addEventListener("click", () => {
      void invoke("close_extractor_window");
    });
    function normalizeURL(value) {
      const raw = value.trim();
      if (!raw) return null;
      const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw) ? raw : `https://${raw}`;
      try {
        const url = new URL(candidate);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url.toString();
      } catch {
        return null;
      }
    }
    function isRemotePage() {
      return location.protocol === "http:" || location.protocol === "https:";
    }
    function isExtractEntryPage() {
      return location.pathname.endsWith("/extractor.html") || location.pathname === "/extractor.html";
    }
    function loadURLFromInput(input) {
      const url = normalizeURL(input.value);
      if (!url) {
        input.focus();
        return;
      }
      setTargetURL(url);
      window.location.href = url;
    }
    function getTargetURL() {
      try {
        const parsed = JSON.parse(window.name || "{}");
        return typeof parsed.aimdWebClipTarget === "string" ? parsed.aimdWebClipTarget : "";
      } catch {
        return "";
      }
    }
    function setTargetURL(url) {
      let parsed = {};
      try {
        parsed = JSON.parse(window.name || "{}");
      } catch {
      }
      parsed.aimdWebClipTarget = url;
      window.name = JSON.stringify(parsed);
    }
    function normalizeText(value) {
      return value.replace(/\s+/g, " ").trim();
    }
    function textContent(selector) {
      return normalizeText(document.querySelector(selector)?.textContent || "");
    }
    function metaContent(selector) {
      return normalizeText(document.querySelector(selector)?.content || "");
    }
    function extractPageTitle() {
      const h1 = textContent("main h1") || textContent("article h1") || textContent("h1");
      if (h1) return h1;
      const metaTitle = metaContent('meta[property="og:title"]') || metaContent('meta[name="twitter:title"]');
      if (metaTitle) return metaTitle;
      return document.title.replace(/\s+\|.*$/, "").replace(/\s+-\s+.*$/, "").trim() || document.title;
    }
    function isBodySectionTitle(text) {
      return /^(overview|introduction|summary|background|use cases?|getting started|considerations|best practices|conclusion|next steps|前言|概述|背景|用例|使用场景|开始|总结)$/i.test(text);
    }
    function isLeadingArticleChrome(node, pageTitle) {
      const text = normalizeText(node.textContent || "").replace(/^#+\s*/, "");
      if (!text) return true;
      if (text === pageTitle || pageTitle.includes(text)) return false;
      if (isBodySectionTitle(text) || text.length > 120) return false;
      const attrText = [node.className, node.id, node.getAttribute("aria-label"), node.getAttribute("role"), node.getAttribute("rel")].join(" ").toLowerCase();
      if (/(breadcrumb|category|categories|tag|tags|byline|author|meta|share|social|permalink|date|time|posted|publish)/.test(attrText)) return true;
      if (/^(by\s+|作者[:：]|author[:：]|on\s+\d{1,2}\s+[a-z]{3,}|permalink|share|分享到|分享)$/i.test(text)) return true;
      const links = Array.from(node.querySelectorAll("a"));
      const onlyTextIsLinks = links.length > 0 && normalizeText(links.map((a) => a.textContent || "").join(" ")) === text;
      return onlyTextIsLinks && links.map((a) => a.href.toLowerCase()).some((href) => /(\/blogs\/[^/]+\/?$|\/category\/|\/categories\/|\/tag\/|\/tags\/|\/author\/|[?&]cat=|[?&]tag=)/.test(href));
    }
    function cleanLeadingArticleChrome(container, pageTitle) {
      for (let i = 0; i < 8; i += 1) {
        const first = Array.from(container.children).find((child) => normalizeText(child.textContent || ""));
        if (!first || !isLeadingArticleChrome(first, pageTitle)) break;
        record("info", "removed leading article chrome", { text: normalizeText(first.textContent || "").slice(0, 160), tag: first.tagName.toLowerCase() });
        first.remove();
      }
    }
    function absoluteHTTPURL(value) {
      const raw = (value || "").trim();
      if (!raw || raw.startsWith("data:") || raw.startsWith("blob:") || /["'{}<>\s]/.test(raw) || raw.includes(':"')) return "";
      try {
        const url = new URL(raw, location.href);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
      } catch {
        return "";
      }
    }
    function isLikelyImageURL(value) {
      try {
        const url = new URL(value, location.href);
        const pathname = url.pathname.toLowerCase();
        return /\.(avif|gif|jpe?g|png|svg|webp)$/.test(pathname) || /[?&](format|fm|mime|content-type)=(avif|gif|jpe?g|png|svg|webp)\b/i.test(url.search);
      } catch {
        return false;
      }
    }
    function imageURLsFromValue(value) {
      const raw = (value || "").trim();
      if (!raw) return [];
      const urls = /* @__PURE__ */ new Set();
      const direct = absoluteHTTPURL(raw);
      if (direct && isLikelyImageURL(direct)) urls.add(direct);
      const srcsetBest = bestFromSrcset(raw);
      if (srcsetBest) urls.add(srcsetBest);
      for (const styleURL of parseStyleImageURLs(raw)) {
        if (isLikelyImageURL(styleURL)) urls.add(styleURL);
      }
      const re = /(?:https?:\/\/|\/\/|\/)[^"'<>{}\s)]+?\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^"'<>{}\s)]*)?/gi;
      let match;
      while (match = re.exec(raw)) {
        const url = absoluteHTTPURL(match[0]);
        if (url && isLikelyImageURL(url)) urls.add(url);
      }
      return Array.from(urls);
    }
    function imageDimensionFromURL(url) {
      const widthMatch = url.match(/(?:[._-]|%2F|\/)width[-_=]?(\d{2,5})\b/i) || url.match(/[?&](?:w|width|resize|size)=?(\d{2,5})\b/i) || url.match(/(?:^|[^\d])(\d{2,5})x(\d{2,5})(?:[^\d]|$)/i);
      if (!widthMatch) return 0;
      if (widthMatch.length >= 3) return Math.max(Number(widthMatch[1]), Number(widthMatch[2]));
      return Number(widthMatch[1]);
    }
    function scoreImageURL(url, descriptorScore) {
      const lower = url.toLowerCase();
      let score = Math.max(descriptorScore, imageDimensionFromURL(url), isLikelyImageURL(url) ? 80 : 0);
      if (/(thumb|thumbnail|avatar|icon|logo|sprite|placeholder|spacer|tracking|pixel|1x1|related|social)/.test(lower)) score -= 600;
      if (/(hero|header|cover|main|featured|article|content|media|image|photo|chart|graph|infographic)/.test(lower)) score += 180;
      if (/\.(?:png|jpe?g|webp|avif)(?:[?#]|$)/.test(lower)) score += 80;
      if (/\.svg(?:[?#]|$)/.test(lower)) score -= 80;
      return score;
    }
    function bestFromSrcset(srcset) {
      if (!srcset) return "";
      let best = "";
      let bestScore = 0;
      for (const rawPart of srcset.split(",")) {
        const part = rawPart.trim();
        if (!part) continue;
        const pieces = part.split(/\s+/);
        const url = absoluteHTTPURL(pieces[0]);
        if (!url) continue;
        const descriptor = pieces[1] || "";
        let descriptorScore = 1;
        if (/^\d+w$/i.test(descriptor)) descriptorScore = Number(descriptor.slice(0, -1));
        else if (/^\d+(?:\.\d+)?x$/i.test(descriptor)) descriptorScore = Number(descriptor.slice(0, -1)) * 1e3;
        const score = scoreImageURL(url, descriptorScore);
        if (!best || score >= bestScore) {
          best = url;
          bestScore = score;
        }
      }
      return best;
    }
    function bestImageURL(img) {
      const candidates = [];
      const picture = img.closest("picture");
      picture?.querySelectorAll("source").forEach((source) => {
        candidates.push(bestFromSrcset(source.getAttribute("srcset")));
        candidates.push(absoluteHTTPURL(source.getAttribute("src")));
      });
      img.querySelectorAll("source").forEach((source) => {
        candidates.push(bestFromSrcset(source.getAttribute("srcset")));
        candidates.push(absoluteHTTPURL(source.getAttribute("src")));
      });
      candidates.push(bestFromSrcset(img.getAttribute("srcset")));
      candidates.push(absoluteHTTPURL(img.currentSrc));
      candidates.push(absoluteHTTPURL(img.getAttribute("src")));
      for (const attr of Array.from(img.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.includes("srcset")) {
          candidates.push(bestFromSrcset(attr.value));
          continue;
        }
        if (/(src|image|img|url|href|original|large|hires|high|thumb|poster)/.test(name)) {
          candidates.push(absoluteHTTPURL(attr.value));
        }
      }
      return candidates.filter(Boolean).sort((a, b) => scoreImageURL(b, 0) - scoreImageURL(a, 0))[0] || "";
    }
    function parseStyleImageURLs(styleValue) {
      if (!styleValue) return [];
      const urls = [];
      const re = /url\((['"]?)(.*?)\1\)/gi;
      let match;
      while (match = re.exec(styleValue)) {
        const url = absoluteHTTPURL(match[2]);
        if (url) urls.push(url);
      }
      return urls;
    }
    function restoreNoscriptImages(root) {
      root.querySelectorAll("noscript").forEach((node) => {
        const html = node.textContent || "";
        if (!/<img|<picture/i.test(html)) return;
        const tpl = document.createElement("template");
        tpl.innerHTML = html;
        normalizeImagesForReadability(tpl.content);
        node.replaceWith(tpl.content.cloneNode(true));
      });
    }
    function isStructuredImageContainer(el) {
      const token = [
        el.tagName,
        el.id,
        el.className,
        el.getAttribute("role"),
        el.getAttribute("aria-label"),
        el.getAttribute("data-module"),
        el.getAttribute("data-component")
      ].join(" ").toLowerCase();
      return /(image[-_\s]?slot|gallery|carousel|slider|slideshow|media[-_\s]?slot|media[-_\s]?gallery|image[-_\s]?gallery)/.test(token);
    }
    function collectImageURLsFromSubtree(el) {
      const urls = /* @__PURE__ */ new Set();
      el.querySelectorAll("img").forEach((img) => {
        const best = bestImageURL(img);
        if (best) urls.add(best);
      });
      el.querySelectorAll("source").forEach((source) => {
        for (const attr of Array.from(source.attributes)) {
          imageURLsFromValue(attr.value).forEach((url) => urls.add(url));
        }
      });
      el.querySelectorAll("a[href]").forEach((anchor) => {
        imageURLsFromValue(anchor.getAttribute("href")).forEach((url) => urls.add(url));
      });
      for (const node of Array.from(el.querySelectorAll("*"))) {
        for (const attr of Array.from(node.attributes)) {
          const name = attr.name.toLowerCase();
          if (/(src|srcset|image|img|url|href|poster|data|json|media|content|style)/.test(name)) {
            imageURLsFromValue(attr.value).forEach((url) => urls.add(url));
          }
        }
      }
      for (const attr of Array.from(el.attributes)) {
        imageURLsFromValue(attr.value).forEach((url) => urls.add(url));
      }
      return Array.from(urls).sort((a, b) => scoreImageURL(b, 0) - scoreImageURL(a, 0));
    }
    function restoreStructuredImageContainers(root) {
      root.querySelectorAll("image-slot, [class], [id], [data-module], [data-component], [role], [aria-label]").forEach((el) => {
        if (!isStructuredImageContainer(el)) return;
        const urls = collectImageURLsFromSubtree(el);
        if (urls.length === 0) return;
        const existing = new Set(Array.from(el.querySelectorAll("img")).map((img) => absoluteHTTPURL(img.getAttribute("src"))).filter(Boolean));
        let appended = 0;
        for (const url of urls) {
          if (existing.has(url)) continue;
          if (scoreImageURL(url, 0) < 80) continue;
          const img = document.createElement("img");
          img.src = url;
          img.alt = normalizeText(el.getAttribute("aria-label") || el.getAttribute("title") || "");
          el.appendChild(img);
          existing.add(url);
          appended += 1;
        }
        if (appended > 0) {
          record("info", "restored structured image container", {
            tag: el.tagName.toLowerCase(),
            id: el.id || "",
            className: String(el.className || "").slice(0, 120),
            appended
          });
        }
      });
    }
    function collectDocumentImageLinks(root) {
      const byURL = /* @__PURE__ */ new Map();
      const add = (url, alt, scoreBoost = 0) => {
        if (!url || !isLikelyImageURL(url)) return;
        const score = scoreImageURL(url, 0) + scoreBoost;
        if (score < 60) return;
        const previous = byURL.get(url);
        const next = { url, alt: normalizeText(alt).replace(/^image:\s*/i, ""), score };
        if (!previous || next.score > previous.score) byURL.set(url, next);
      };
      root.querySelectorAll("a[href]").forEach((anchor) => {
        const href = absoluteHTTPURL(anchor.getAttribute("href"));
        if (!href || !isLikelyImageURL(href)) return;
        const text = normalizeText(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.textContent || "");
        const articleish = Boolean(anchor.closest("article, main, [role='main']"));
        const excluded = Boolean(anchor.closest("nav, header, footer, aside, [class*='related'], [id*='related'], [class*='newsletter'], [id*='newsletter'], [class*='subscribe'], [id*='subscribe']"));
        if (excluded) return;
        add(href, text, articleish ? 200 : 0);
      });
      root.querySelectorAll("img").forEach((img) => {
        const url = bestImageURL(img);
        const articleish = Boolean(img.closest("article, main, [role='main']"));
        const excluded = Boolean(img.closest("nav, header, footer, aside, [class*='related'], [id*='related'], [class*='newsletter'], [id*='newsletter'], [class*='subscribe'], [id*='subscribe']"));
        if (excluded) return;
        add(url, img.alt || img.getAttribute("aria-label") || img.getAttribute("title") || "", articleish ? 180 : 80);
      });
      return Array.from(byURL.values()).sort((a, b) => b.score - a.score).slice(0, 24);
    }
    function markdownImageURLSet(container) {
      const urls = /* @__PURE__ */ new Set();
      container.querySelectorAll("img").forEach((img) => {
        const src = absoluteHTTPURL(img.getAttribute("src"));
        if (src) urls.add(src);
      });
      container.querySelectorAll("a[href]").forEach((anchor) => {
        const href = absoluteHTTPURL(anchor.getAttribute("href"));
        if (href && isLikelyImageURL(href)) urls.add(href);
      });
      return urls;
    }
    function imageIdentity(url) {
      try {
        const parsed = new URL(url);
        return parsed.pathname.toLowerCase().replace(/\.width-\d+\.format-[^.]+(?=\.)/g, "").replace(/[-_.](?:width|w)[-_=]?\d{2,5}/g, "");
      } catch {
        return url.toLowerCase();
      }
    }
    function shouldKeepExtractedImage(url) {
      if (!url || !isLikelyImageURL(url)) return false;
      const lower = url.toLowerCase();
      if (/[<>{}"'\s]/.test(url)) return false;
      if (/(related|newsletter|subscribe|social|avatar|logo|icon|sprite|placeholder|tracking|pixel|1x1)/.test(lower)) return false;
      if (/gweb-uniblog-publish-prod\/images\/(vibe_coding_course|gemini_embedding|g1-ais|gemini-3\.1-flash-tts|api_hero|colablearning)/i.test(url)) return false;
      return true;
    }
    function removeBadImages(container) {
      container.querySelectorAll("img").forEach((img) => {
        const src = absoluteHTTPURL(img.getAttribute("src"));
        if (!shouldKeepExtractedImage(src)) img.remove();
      });
      container.querySelectorAll("a[href]").forEach((anchor) => {
        const href = absoluteHTTPURL(anchor.getAttribute("href"));
        if (href && isLikelyImageURL(href) && !shouldKeepExtractedImage(href)) anchor.remove();
      });
    }
    function backfillMissingImages(container, captured) {
      const existing = markdownImageURLSet(container);
      const existingIdentities = new Set(Array.from(existing).map(imageIdentity));
      const missing = captured.filter(
        (item) => !existing.has(item.url) && !existingIdentities.has(imageIdentity(item.url)) && item.score >= 120
      );
      if (missing.length === 0) return;
      const insertionTarget = Array.from(container.querySelectorAll("h2, h3, p, ul, ol")).find((el) => /native charts|infographics|visual|chart|graphic|图表|可视化/i.test(normalizeText(el.textContent || "")));
      const fragment = document.createDocumentFragment();
      for (const item of missing.slice(0, 12)) {
        const figure = document.createElement("figure");
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.alt;
        figure.appendChild(img);
        fragment.appendChild(figure);
      }
      if (insertionTarget?.parentElement) {
        insertionTarget.parentElement.insertBefore(fragment, insertionTarget.nextSibling);
      } else {
        container.appendChild(fragment);
      }
      record("info", "backfilled missing image links", { count: missing.length });
    }
    function normalizeImagesForReadability(root) {
      restoreNoscriptImages(root);
      restoreStructuredImageContainers(root);
      root.querySelectorAll("img").forEach((img) => {
        const best = bestImageURL(img);
        if (best) img.setAttribute("src", best);
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        if ((img.getAttribute("src") || "").startsWith("data:image")) img.remove();
      });
      root.querySelectorAll("[style]").forEach((el) => {
        if (el.querySelector("img")) return;
        const best = parseStyleImageURLs(el.getAttribute("style")).sort((a, b) => scoreImageURL(b, 0) - scoreImageURL(a, 0))[0];
        if (!best || scoreImageURL(best, 0) < 80) return;
        const img = document.createElement("img");
        img.src = best;
        img.alt = normalizeText(el.getAttribute("aria-label") || el.getAttribute("title") || "");
        el.appendChild(img);
      });
    }
    function restoreImageLinks(container) {
      container.querySelectorAll("a[href]").forEach((anchor) => {
        const href = absoluteHTTPURL(anchor.getAttribute("href"));
        if (!href || !isLikelyImageURL(href)) return;
        const img = anchor.querySelector("img");
        if (img) {
          img.setAttribute("src", href);
          img.removeAttribute("srcset");
          img.removeAttribute("sizes");
          return;
        }
        const text = normalizeText(anchor.textContent || "");
        const label = anchor.getAttribute("aria-label") || anchor.getAttribute("title") || text;
        if (text && text.length > 120) return;
        const replacement = document.createElement("img");
        replacement.src = href;
        replacement.alt = label.replace(/^image:\s*/i, "");
        anchor.replaceWith(replacement);
      });
    }
    async function autoScroll() {
      const scrollStartedAt = performance.now();
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        let done = false;
        const finish = (reason) => {
          if (done) return;
          done = true;
          clearInterval(timer);
          clearTimeout(safetyTimer);
          record("info", `autoScroll ${reason}`, { elapsedMs: Math.round(performance.now() - scrollStartedAt), totalHeight, scrollHeight: document.body.scrollHeight });
          resolve();
        };
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight - window.innerHeight) finish("finished");
        }, 100);
        const safetyTimer = setTimeout(() => finish("timeout"), 5e3);
      });
    }
    async function runExtraction() {
      if (extracting) return;
      extracting = true;
      loadBtn.disabled = true;
      loadBtn.textContent = "\u63D0\u53D6\u4E2D";
      startPanel.hidden = true;
      previewPanel.hidden = true;
      workPanel.hidden = false;
      document.body.style.overflow = "hidden";
      const startedAt = performance.now();
      try {
        const pageTitle = extractPageTitle();
        record("info", "extraction started", { url: location.href });
        await autoScroll();
        await new Promise((r) => setTimeout(r, 800));
        const documentClone = document.cloneNode(true);
        documentClone.querySelectorAll(".aimd-clip-shell, style").forEach((node) => {
          if (node.classList?.contains("aimd-clip-shell")) node.remove();
        });
        normalizeImagesForReadability(documentClone);
        const capturedImages = collectDocumentImageLinks(documentClone);
        record("info", "captured image links before readability", { count: capturedImages.length });
        const reader = new import_readability.Readability(documentClone);
        const article = reader.parse();
        record("info", "readability finished", { success: Boolean(article), title: article?.title || "", pageTitle, contentChars: article?.content?.length || 0 });
        if (!article) {
          await invoke("web_clip_raw_extracted", { payload: { success: false, title: document.title, diagnostics } });
          return;
        }
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = article.content || "";
        cleanLeadingArticleChrome(tempDiv, pageTitle);
        restoreImageLinks(tempDiv);
        normalizeImagesForReadability(tempDiv);
        backfillMissingImages(tempDiv, capturedImages);
        removeBadImages(tempDiv);
        article.content = tempDiv.innerHTML;
        const uniqueUrls = /* @__PURE__ */ new Set();
        tempDiv.querySelectorAll("img").forEach((img) => {
          const src = absoluteHTTPURL(img.getAttribute("src"));
          if (shouldKeepExtractedImage(src)) uniqueUrls.add(src);
        });
        const images = Array.from(uniqueUrls).map((url) => ({ url, data: [] }));
        record("info", "image urls handed to backend", { count: images.length });
        record("info", "extraction completed", { elapsedMs: Math.round(performance.now() - startedAt) });
        await invoke("web_clip_raw_extracted", {
          payload: { success: true, title: pageTitle || article.title, content: article.content, images, diagnostics }
        });
      } catch (err) {
        record("error", "extraction error", { elapsedMs: Math.round(performance.now() - startedAt), error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
        await invoke("web_clip_raw_extracted", { payload: { success: false, error: err.message || "Unknown error", diagnostics } });
      } finally {
        extracting = false;
      }
    }
    function assetIDFromURL(value) {
      if (!value.startsWith(ASSET_URI_PREFIX)) return "";
      const rest = value.slice(ASSET_URI_PREFIX.length);
      const end = rest.search(/[?#]/);
      return end >= 0 ? rest.slice(0, end) : rest;
    }
    function rewriteAssetURLs(html, assets) {
      if (!assets.length || !html.includes(ASSET_URI_PREFIX)) return html;
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      const byID = new Map(assets.map((asset) => [asset.id, asset]));
      tpl.content.querySelectorAll("img").forEach((img) => {
        const source = img.getAttribute("src") || "";
        const id = img.getAttribute("data-asset-id") || assetIDFromURL(source);
        const asset = id ? byID.get(id) : null;
        const localPath = asset?.localPath || asset?.url || "";
        if (!localPath) return;
        img.src = convertFileSrc(localPath);
      });
      return tpl.innerHTML;
    }
    function escapeHTML(value) {
      return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    }
  })();
})();
