module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("source/css");
  eleventyConfig.addPassthroughCopy("source/scripts");
  eleventyConfig.addPassthroughCopy("source/assets");
  
  eleventyConfig.setServerOptions({
    showAllHosts: true,
  });

  return {
    pathPrefix: "/leabharlann/",
    dir: {
      input: "source",
      output: "public"
    }
  };
};
