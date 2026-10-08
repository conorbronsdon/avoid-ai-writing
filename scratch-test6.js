const before = "These system ";
const after = " support for older protocols";

const FEATURES_VERB_SUBJECTS = /\b(?:library|tool|app|application|platform|system|language|service|product|update|release|version|site|website|game|device|model|framework|package|plugin|extension|which|what|that|who|it|he|she)\s+$/i;

function featuresIsNoun(before, after) {
  if (FEATURES_VERB_SUBJECTS.test(before) && /^\s+support\s+for\b/i.test(after)) {
    if (!/\b(?:these|those|all|some|many|few|various|multiple|several)\s+[\w-]+\s+$/i.test(before)) {
      return false; // verb
    }
  }
  return true; // noun
}

console.log(featuresIsNoun(before, after));
console.log(featuresIsNoun("The system ", after));
