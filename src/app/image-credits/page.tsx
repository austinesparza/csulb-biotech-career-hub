const MICROSCOPY = [
  ['Fibroblast cytoskeleton', 'Heiti Paves', 'https://commons.wikimedia.org/wiki/File:Fibroblastid.jpg', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/'],
  ['Basal-like breast cancer histology', 'Mikael Häggström, M.D.', 'https://commons.wikimedia.org/wiki/File:Histopathology_of_basal-like_breast_cancer.jpg', 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
  ['DNA in oral cancer cells', 'Korinna', 'https://commons.wikimedia.org/wiki/File:Fluorescence_microscopy_of_the_DNA_of_the_oral_cancer_cells.jpg', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  ['Chromosome research image', 'Oudelaar et al.', 'https://commons.wikimedia.org/wiki/File:Image_Data_Resource_-_idr0084_-_9842150.jpg', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  ['NEAT1 paraspeckles in U-2 OS cells', 'Aeffenberger', 'https://commons.wikimedia.org/wiki/File:NEAT1_paraspeckles_in_U-2_OS_cells.jpg', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  ['Single-cell sequencing maps', 'Garcia-Alonso, Lorenzi, Mazzeo et al.', 'https://commons.wikimedia.org/wiki/File:UMAP_of_somatic_cell_states_(colour)_in_the_human_scRNA-seq_,_human_scATAC-seq_and_mouse_scRNA-seq_datasets.jpg', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  ['Five-color confocal microscopy of Marchantia cells', 'ZEISS Microscopy', 'https://commons.wikimedia.org/wiki/File:Confocal_microscopy_with_spectral_imaging-_Five-color_observation_of_organelles_in_Marchantia_polymorpha_thallus_cells_(17594447615).jpg', 'CC BY-SA 2.0', 'https://creativecommons.org/licenses/by-sa/2.0/'],
  ['Cell-culture bioreactors', 'Habin Zhang', 'https://commons.wikimedia.org/wiki/File:Bioreactor_for_cell_culture_in_the_laboratory.jpg', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  ['Protein crystals', 'CSIRO', 'https://commons.wikimedia.org/wiki/File:CSIRO_ScienceImage_418_XRay_Crystallography_Protein_Crystals.jpg', 'CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/'],
  ['Green fluorescent neurons', 'ManuelSchottdorf', 'https://commons.wikimedia.org/wiki/File:GFP_Neurons.png', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  ['Toxoplasma parasites in a fibroblast host cell', 'Morne Arin', 'https://commons.wikimedia.org/wiki/File:Toxoplasma_parasites_(tachyzoites)_in_a_fibroblast_host_cell.png', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  ['Living HeLa cells with labeled nuclei, microtubules, and mitochondria', '8x57is', 'https://commons.wikimedia.org/wiki/File:Multicolor_fluorescence_image_of_living_HeLa_cells.jpg', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  ['DNA identification laboratory', 'U.S. Air Force photo by Staff Sgt. Nicole Leidholm', 'https://commons.wikimedia.org/wiki/File:Armed_Forces_DNA_Identification_Laboratory_analysts_2018.jpg', 'Public domain', 'https://commons.wikimedia.org/wiki/Commons:Copyright_rules_by_territory/United_States'],
] as const;

const LOGOS = [
  ['Johnson & Johnson', 'https://commons.wikimedia.org/wiki/File:Johnson_and_Johnson_Logo.svg'],
  ['Amgen', 'https://commons.wikimedia.org/wiki/File:Amgen.svg'],
  ['Ginkgo Bioworks', 'https://commons.wikimedia.org/wiki/File:Ginkgo_Bioworks_logo.svg'],
  ['Sanofi', 'https://commons.wikimedia.org/wiki/File:Sanofi-2022.svg'],
  ['MD Anderson Cancer Center', 'https://www.mdanderson.org/'],
  ['CAS', 'https://www.cas.org/'],
] as const;

export default function ImageCreditsPage() {
  return (
    <div className="site-wrap credits-page">
      <header className="page-head">
        <h1>Image credits</h1>
        <p className="lede">Real scientific imagery, credited to the people and institutions that made it available.</p>
      </header>

      <section className="credits-section">
        <h2>Scientific images</h2>
        <ul>
          {MICROSCOPY.map(([title, creator, source, license, licenseUrl]) => (
            <li key={source}>
              <a href={source} target="_blank" rel="noreferrer">{title}</a>
              <span>{creator}</span>
              <a href={licenseUrl} target="_blank" rel="noreferrer">{license}</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="credits-section">
        <h2>Employer marks</h2>
        <p>Employer marks identify the organization named in a listing and do not imply sponsorship.</p>
        <ul>
          {LOGOS.map(([name, source]) => (
            <li key={source}><a href={source} target="_blank" rel="noreferrer">{name}</a></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
